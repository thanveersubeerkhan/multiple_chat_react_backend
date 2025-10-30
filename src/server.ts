import express from "express";
import bodyParser from "body-parser";
import { ChatOpenAI } from "@langchain/openai";
import dotenv from "dotenv";
import cors from "cors";
import { neon } from '@neondatabase/serverless';

dotenv.config();

const app = express();
app.use(bodyParser.json());
app.use(
  cors(
//     {
//     origin: "http://localhost:5173",
//     methods: ["GET", "POST", "PUT", "DELETE"],
//     allowedHeaders: ["Content-Type"],
//   }
)
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

// Chat endpoint for NEW chats (without chatId)
app.post("/chat", async (req, res) => {
  const { messages = [] }: ChatRequest = req.body;
  logger.route('POST', '/chat', {
    messageCount: messages.length,
    hasUserMessage: messages.some(m => m.role === 'user')
  });

  try {
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
    await handleChatMessages(currentChatId, messages, res, true);
  } catch (err: any) {
    logger.error("Error in /chat endpoint:", err);
    res.status(500).json({
      error: "Internal Server Error",
      details: err.message,
    });
  }
});

// Chat endpoint for EXISTING chats (with chatId)
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

    await handleChatMessages(currentChatId, messages, res, false);
  } catch (err: any) {
    logger.error("Error in /chat/:chatId endpoint:", err);
    res.status(500).json({
      error: "Internal Server Error",
      details: err.message,
    });
  }
});

// Helper function to handle chat messages and AI response
// async function handleChatMessages(
//   chatId: number,
//   messages: any[],
//   res: express.Response,
//   isNewChat: boolean
// ) {
//   logger.info("Processing chat messages", { chatId, isNewChat, incomingMessages: messages.length });
//   const currentUserMessage = messages.filter(m => m.role === "user").pop();
//   if (!currentUserMessage) {
//     logger.warn("No user message found");
//     res.status(400).json({ error: "No user message provided" });
//     return;
//   }
//   const userMessageText = currentUserMessage.content || "";
//   logger.info("Extracted user message text", { userMessageText, currentUserMessage });

//   await sql`
//     INSERT INTO messages (chat_id, role, content)
//     VALUES (${chatId}, 'user', ${userMessageText})
//   `;

//   const allMessages = await sql`
//     SELECT role, content FROM messages
//     WHERE chat_id = ${chatId}
//     ORDER BY created_at ASC
//   `;
//   logger.info("All messages from DB", { allMessages });

//   let conversationContext = "You are a helpful AI assistant. Here is the conversation history:\n\n";
//   allMessages.forEach((msg) => {
//     conversationContext += `${msg.role}: ${msg.content}\n\n`;
//   });
//   conversationContext += `assistant:`;
//   logger.info("Conversation context", { conversationContext });

//   const model = new ChatOpenAI({
//     openAIApiKey: process.env.OPENAI_API_KEY!,
//     modelName: "gpt-3.5-turbo", // Use a valid model name
//     maxTokens: 500,
//     streaming: true,
//   });

//   try {
//     const stream = await model.stream(conversationContext);
//     res.writeHead(200, {
//       'Content-Type': 'text/event-stream',
//       'Cache-Control': 'no-cache',
//       'Connection': 'keep-alive',
//       'Access-Control-Allow-Origin': '*',
//       'X-Chat-Id': chatId.toString(),
//     });

//     let fullResponse = "";
//     for await (const chunk of stream) {
//       logger.info("Received chunk", { chunk });
//       if (chunk.content) {
//         const content = chunk.content;
//         fullResponse += content;
//         const data = JSON.stringify({ type: "text-delta", textDelta: content });
//         res.write(`data: ${data}\n\n`);
//       }
//     }
//     res.write('data: [DONE]\n\n');
//     logger.info("Stream completed successfully", {
//       chatId,
//       responseLength: fullResponse.length,
//       responsePreview: fullResponse.substring(0, 100)
//     });

//     if (fullResponse.trim()) {
//       await sql`
//         INSERT INTO messages (chat_id, role, content)
//         VALUES (${chatId}, 'assistant', ${fullResponse})
//       `;
//     }
//     await sql`UPDATE chats SET updated_at = NOW() WHERE id = ${chatId}`;
//     res.end();
//   } catch (error: any) {
//     logger.error("Error during AI streaming", error);
//     const errorData = JSON.stringify({ type: "error", error: "AI Service Error", details: error.message });
//     res.write(`data: ${errorData}\n\n`);
//     res.end();
//   }
// }
// Helper function to handle chat messages and AI response
async function handleChatMessages(
  chatId: number,
  messages: any[],
  res: express.Response,
  isNewChat: boolean
) {
  logger.info("Processing chat messages", { chatId, isNewChat, incomingMessages: messages.length });
  
  const currentUserMessage = messages.filter(m => m.role === "user").pop();
  if (!currentUserMessage) {
    logger.warn("No user message found");
    return res.status(400).json({ error: "No user message provided" }); // ✅ Add return
  }
  
  const userMessageText = currentUserMessage.content || "";
  logger.info("Extracted user message text", { userMessageText, currentUserMessage });

  try {
    // Save user message to database
    await sql`
      INSERT INTO messages (chat_id, role, content)
      VALUES (${chatId}, 'user', ${userMessageText})
    `;

    const allMessages = await sql`
      SELECT role, content FROM messages
      WHERE chat_id = ${chatId}
      ORDER BY created_at ASC
    `;
    logger.info("All messages from DB", { allMessages });

    let conversationContext = "You are a helpful AI assistant. Here is the conversation history:\n\n";
    allMessages.forEach((msg) => {
      conversationContext += `${msg.role}: ${msg.content}\n\n`;
    });
    conversationContext += `assistant:`;
    logger.info("Conversation context", { conversationContext });

    // const model = new ChatOpenAI({
    //   openAIApiKey: process.env.OPENAI_API_KEY!,
    //   modelName: "gpt-4.1-mini",
    //   maxTokens: 500,
    //   streaming: true,
    // });
    const model = new ChatOpenAI({
    model: 'google/gemma-3n-e2b-it:free',
    temperature: 0.8,
    maxTokens: 500,
    streaming: true,
    // apiKey: process.env.OPENROUTER_API_KEY, // Or pass it directly
     

    // apiKey: process.env.OPENROUTER_API_KEY,
    configuration: {
         apiKey: process.env.OPENROUTER_API_KEY, 
        baseURL: "https://openrouter.ai/api/v1",


    },
});

    // Set headers before starting the stream
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Chat-Id': chatId.toString(),
    });

    const stream = await model.stream(conversationContext);
    let fullResponse = "";
    
    for await (const chunk of stream) {
      logger.debug("Received chunk", { chunk }); // ✅ Changed to debug to reduce noise
      if (chunk.content) {
        const content = chunk.content;
        fullResponse += content;
        const data = JSON.stringify({ type: "text-delta", textDelta: content });
        res.write(`data: ${data}\n\n`);
      }
    }

    // ✅ Send completion signal
    res.write('data: [DONE]\n\n');
    
    logger.info("Stream completed successfully", {
      chatId,
      responseLength: fullResponse.length,
      responsePreview: fullResponse.substring(0, 100)
    });

    // ✅ Save assistant response to database
    if (fullResponse.trim()) {
      await sql`
        INSERT INTO messages (chat_id, role, content)
        VALUES (${chatId}, 'assistant', ${fullResponse})
      `;
    }
    
    // ✅ Update chat timestamp
    await sql`UPDATE chats SET updated_at = NOW() WHERE id = ${chatId}`;
    
    // ✅ Properly end the response
    res.end();
    
  } catch (error: any) {
    logger.error("Error during AI streaming", error);
    
    // ✅ Check if headers were already sent
    if (res.headersSent) {
      const errorData = JSON.stringify({ 
        type: "error", 
        error: "AI Service Error", 
        details: error.message 
      });
      res.write(`data: ${errorData}\n\n`);
      res.end(); // ✅ Still need to end even if headers sent
    } else {
      res.status(500).json({ 
        error: "AI Service Error", 
        details: error.message 
      });
    }
  }
}

app.listen(3000, () => {
  console.log("⚡ AI Agent backend running on http://localhost:3000");
  console.log("🚀 Using OpenAI GPT-4 Mini");
});
