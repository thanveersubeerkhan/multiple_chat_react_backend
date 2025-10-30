import express from "express";
import bodyParser from "body-parser";
import { ChatMistralAI } from "@langchain/mistralai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import dotenv from "dotenv";
import cors from "cors";
import { neon } from '@neondatabase/serverless';

dotenv.config();

const app = express();
app.use(bodyParser.json());
app.use(
  cors({
    origin: "http://localhost:5173",
    methods: ["GET", "POST", "PUT", "DELETE"],
    allowedHeaders: ["Content-Type"],
  })
);

const sql = neon(process.env.DATABASE_URL!);

// Types
interface Chat {
  id: number;
  title: string;
  created_at: string;
  updated_at: string;
}

interface DBMessages {
  id: number;
  chat_id: number;
  role: string;
  content: string;
  created_at: string;
}

interface ChatRequest {
  messages?: Array<{
    role: string;
    parts?: Array<{
      type: string;
      text: string;
    }>;
    content?: string;
  }>;
}

// Enhanced logging utility
const logger = {
  info: (message: string, data?: any) => {
    console.log(`🔵 [BACKEND] ${message}`, data || '');
  },
  error: (message: string, error?: any) => {
    console.error(`🔴 [BACKEND] ${message}`, error || '');
  },
  warn: (message: string, data?: any) => {
    console.warn(`🟡 [BACKEND] ${message}`, data || '');
  },
  debug: (message: string, data?: any) => {
    console.log(`🟣 [BACKEND] ${message}`, data || '');
  },
  route: (method: string, path: string, data?: any) => {
    console.log(`🟢 [ROUTE] ${method} ${path}`, data || '');
  }
};

// Initialize database
async function initializeDatabase() {
  try {
    logger.info("Initializing database...");
    
    // Drop and recreate tables to ensure clean state
    await sql`DROP TABLE IF EXISTS messages CASCADE`;
    await sql`DROP TABLE IF EXISTS chats CASCADE`;
    
    // Create chats table
    await sql`
      CREATE TABLE chats (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `;
    
    // Create messages table
    await sql`
      CREATE TABLE messages (
        id SERIAL PRIMARY KEY,
        chat_id INTEGER REFERENCES chats(id) ON DELETE CASCADE,
        role VARCHAR(50) NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;
    
    logger.info("Database tables created successfully");
  } catch (error) {
    logger.error("Database initialization error:", error);
    throw error;
  }
}

// Initialize database on startup
initializeDatabase().catch(console.error);

// Get all chats
app.get("/chats", async (req, res) => {
  logger.route('GET', '/chats');
  
  try {
    const chats = await sql`
      SELECT id, title, created_at, updated_at 
      FROM chats 
      ORDER BY updated_at DESC
    `;
    
    logger.info("Chats fetched successfully", { count: chats.length });
    res.json(chats);
  } catch (err) {
    logger.error("Error fetching chats:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Get a specific chat with messages
app.get("/chats/:id", async (req, res) => {
  const { id } = req.params;
  logger.route('GET', `/chats/${id}`, { chatId: id });
  
  try {
    const chat = await sql`
      SELECT * FROM chats WHERE id = ${id}
    `;
    
    if (chat.length === 0) {
      logger.warn("Chat not found", { chatId: id });
      return res.status(404).json({ error: "Chat not found" });
    }
    
    const messages = await sql`
      SELECT * FROM messages 
      WHERE chat_id = ${id} 
      ORDER BY created_at ASC
    `;
    
    logger.info("Chat fetched successfully", { 
      chatId: id, 
      messageCount: messages.length 
    });
    
    res.json({
      ...chat[0],
      messages: messages.map(m => ({
        id: m.id.toString(),
        role: m.role,
        content: m.content,
        parts: [{ type: "text", text: m.content }]
      }))
    });
  } catch (err) {
    logger.error("Error fetching chat:", { chatId: id, error: err });
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Create a new chat
app.post("/chats", async (req, res) => {
  const { title = "New Chat" } = req.body;
  logger.route('POST', '/chats', { title });
  
  try {
    const newChat = await sql`
      INSERT INTO chats (title) 
      VALUES (${title})
      RETURNING *
    `;
    
    logger.info("New chat created", { chatId: newChat[0].id });
    res.status(201).json(newChat[0]);
  } catch (err) {
    logger.error("Error creating chat:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Update chat title
app.put("/chats/:id", async (req, res) => {
  const { id } = req.params;
  const { title } = req.body;
  logger.route('PUT', `/chats/${id}`, { chatId: id, newTitle: title });
  
  try {
    const updatedChat = await sql`
      UPDATE chats 
      SET title = ${title}, updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `;
    
    if (updatedChat.length === 0) {
      logger.warn("Chat not found for update", { chatId: id });
      return res.status(404).json({ error: "Chat not found" });
    }
    
    logger.info("Chat title updated successfully", { chatId: id });
    res.json(updatedChat[0]);
  } catch (err) {
    logger.error("Error updating chat:", { chatId: id, error: err });
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Delete a chat
app.delete("/chats/:id", async (req, res) => {
  const { id } = req.params;
  logger.route('DELETE', `/chats/${id}`, { chatId: id });
  
  try {
    await sql`DELETE FROM chats WHERE id = ${id}`;
    
    logger.info("Chat deleted successfully", { chatId: id });
    res.status(204).send();
  } catch (err) {
    logger.error("Error deleting chat:", { chatId: id, error: err });
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// FIXED: Chat endpoint for NEW chats (without chatId)
app.post("/chat", async (req, res) => {
  const { messages = [] }: ChatRequest = req.body;
  logger.route('POST', '/chat', { 
    messageCount: messages.length,
    hasUserMessage: messages.some(m => m.role === 'user')
  });

  try {
    // Create new chat
    const firstUserMessage = messages.find(m => m.role === "user");
    const title = firstUserMessage?.parts?.[0]?.text?.slice(0, 50) || 
                 firstUserMessage?.content?.slice(0, 50) || 
                 "New Chat";
    
    logger.info("Creating new chat", { title });
    
    const newChat = await sql`
      INSERT INTO chats (title) 
      VALUES (${title})
      RETURNING id, title
    `;
    const currentChatId = newChat[0].id;
    
    logger.info("New chat created with ID", { chatId: currentChatId });

    // Process and handle messages - FIXED: Handle template variables
    await handleChatMessages(currentChatId, messages, res, true);
  } catch (err: any) {
    logger.error("Error in /chat endpoint:", err);
    res.status(500).json({
      error: "Internal Server Error",
      details: err.message,
    });
  }
});

// FIXED: Chat endpoint for EXISTING chats (with chatId)
app.post("/chat/:chatId", async (req, res) => {
  const { chatId } = req.params;
  const { messages = [] }: ChatRequest = req.body;
  
  logger.route('POST', `/chat/${chatId}`, { 
    chatId,
    messageCount: messages.length,
    hasUserMessage: messages.some(m => m.role === 'user')
  });

  try {
    const currentChatId = parseInt(chatId);
    
    // Verify chat exists
    const existingChat = await sql`
      SELECT id, title FROM chats WHERE id = ${currentChatId}
    `;
    
    if (existingChat.length === 0) {
      logger.warn("Chat not found", { chatId: currentChatId });
      return res.status(404).json({ error: "Chat not found" });
    }

    logger.info("Using existing chat", { 
      chatId: currentChatId, 
      title: existingChat[0].title 
    });
    
    // Process and handle messages - FIXED: Handle template variables
    await handleChatMessages(currentChatId, messages, res, false);
  } catch (err: any) {
    logger.error("Error in /chat/:chatId endpoint:", err);
    res.status(500).json({
      error: "Internal Server Error",
      details: err.message,
    });
  }
});

// FIXED: Helper function to handle chat messages and AI response
async function handleChatMessages(
  chatId: number, 
  messages: any[], 
  res: express.Response, 
  isNewChat: boolean
) {
  logger.info("Processing chat messages", { 
    chatId, 
    isNewChat,
    incomingMessages: messages.length 
  });

  // Normalize messages - get only the current user message
  const currentUserMessage = messages
    .filter(m => m.role === "user")
    .pop();

  if (!currentUserMessage) {
    logger.warn("No user message found");
    res.status(400).json({ error: "No user message provided" });
    return;
  }

  const userMessageText = currentUserMessage.parts?.[0]?.text || currentUserMessage.content || "";

  // Save user message to database
  logger.info("Saving user message to database", { 
    chatId, 
    messageLength: userMessageText.length 
  });
  
  await sql`
    INSERT INTO messages (chat_id, role, content)
    VALUES (${chatId}, 'user', ${userMessageText})
  `;

  // Get ALL messages for this chat to maintain full context
  const allMessages = await sql`
    SELECT role, content FROM messages 
    WHERE chat_id = ${chatId} 
    ORDER BY created_at ASC
  `;

  logger.info("Retrieved full chat history from database", { 
    chatId, 
    messageCount: allMessages.length 
  });

  // Initialize AI model with faster settings
  logger.info("Initializing AI model with fast settings");
  const model = new ChatMistralAI({
    apiKey: process.env.OPENROUTER_API_KEY!,
    model: "mistralai/mistral-small-3.2-24b-instruct:free", // Fast model
    temperature: 0.7,
    maxTokens: 500, // Limit response length for speed
    streaming: true,
    serverURL: "https://openrouter.ai/api",
  });

  try {
    // FIXED: Use simple string concatenation instead of ChatPromptTemplate
    // to avoid template variable issues
    let conversationContext = "You are a helpful AI assistant. Here is the conversation history:\n\n";
    
    // Build conversation context from all messages
    allMessages.forEach((msg) => {
      conversationContext += `${msg.role}: ${msg.content}\n\n`;
    });

    // Add the current user message
    conversationContext += `user: ${userMessageText}\n\nassistant:`;

    logger.info("Starting direct AI streaming");
    
    // Use direct model call instead of chain to avoid template issues
    const stream = await model.stream(conversationContext);

    // Set proper headers for fast SSE
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Chat-Id': chatId.toString(),
    });

    let fullResponse = "";
    
    // Stream response directly for maximum speed
    for await (const chunk of stream) {
      if (chunk.content) {
        const content = chunk.content;
        fullResponse += content;
        
        // Send as SSE format for AI SDK compatibility
        const data = JSON.stringify({
          type: "text-delta",
          textDelta: content
        });
        
        res.write(`data: ${data}\n\n`);
      }
    }

    // Send completion signal
    res.write('data: [DONE]\n\n');

    logger.info("Stream completed successfully", { 
      chatId, 
      responseLength: fullResponse.length,
      responsePreview: fullResponse.substring(0, 100) 
    });

    // Save assistant's response to database
    if (fullResponse.trim()) {
      logger.info("Saving assistant response to database", { 
        chatId, 
        responseLength: fullResponse.length 
      });
      
      await sql`
        INSERT INTO messages (chat_id, role, content)
        VALUES (${chatId}, 'assistant', ${fullResponse})
      `;
    }

    // Update chat's updated_at timestamp
    logger.info("Updating chat timestamp", { chatId });
    await sql`
      UPDATE chats 
      SET updated_at = NOW()
      WHERE id = ${chatId}
    `;

    logger.info("Chat processing completed successfully", { chatId });
    res.end();
    
  } catch (error: any) {
    logger.error("Error during AI streaming", error);
    
    // Send error as SSE for proper frontend handling
    const errorData = JSON.stringify({
      type: "error",
      error: "AI Service Error",
      details: error.message
    });
    
    res.write(`data: ${errorData}\n\n`);
    res.end();
  }
}

app.listen(3000, () => {
  console.log("⚡ AI Agent backend running on http://localhost:3000");
  console.log("🚀 Fixed template variable handling");
});