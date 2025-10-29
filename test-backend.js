const axios = require('axios');
const BASE_URL = 'http://localhost:3000';

const logger = {
  info: (message, data) => console.log(`🔵 ${message}`, data || ''),
  success: (message, data) => console.log(`✅ ${message}`, data || ''),
  error: (message, error) => console.error(`🔴 ${message}`, error || '')
};

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Create a new chat and add 3 messages
async function createChatWithMessages(chatName, messages) {
  let chatId = null;
  
  try {
    logger.info(`Creating chat: "${chatName}"`);
    
    // Create initial chat with first message
    const response = await axios.post(`${BASE_URL}/chat`, {
      messages: [{ role: 'user', parts: [{ type: 'text', text: messages[0] }] }]
    }, { responseType: 'stream' });

    // Get chat ID from headers
    return new Promise((resolve, reject) => {
      response.data.on('data', (chunk) => {
        const chunkStr = chunk.toString();
        if (!chatId && response.headers['x-chat-id']) {
          chatId = response.headers['x-chat-id'];
        }
      });

      response.data.on('end', async () => {
        if (chatId) {
          logger.success(`Chat created with ID: ${chatId}`);
          
          // Add remaining messages
          for (let i = 1; i < messages.length; i++) {
            await delay(1000);
            await sendMessage(chatId, messages[i]);
          }
          
          resolve(chatId);
        } else {
          reject(new Error('No chat ID received'));
        }
      });

      response.data.on('error', reject);
    });

  } catch (error) {
    logger.error('Error creating chat:', error.response?.data || error.message);
    throw error;
  }
}

// Send a message to existing chat
async function sendMessage(chatId, message) {
  try {
    const response = await axios.post(`${BASE_URL}/chat/${chatId}`, {
      messages: [{ role: 'user', parts: [{ type: 'text', text: message }] }]
    }, { responseType: 'stream' });

    return new Promise((resolve) => {
      let fullResponse = '';
      
      response.data.on('data', (chunk) => {
        const lines = chunk.toString().split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data !== '[DONE]') {
              try {
                const parsed = JSON.parse(data);
                if (parsed.textDelta) {
                  fullResponse += parsed.textDelta;
                }
              } catch (e) {}
            }
          }
        }
      });

      response.data.on('end', () => {
        logger.info(`Message sent to chat ${chatId}: "${message}"`);
        resolve(fullResponse);
      });
    });

  } catch (error) {
    logger.error('Error sending message:', error.response?.data || error.message);
    throw error;
  }
}

// Test chat context
async function testChatContext(chatId, expectedContext) {
  logger.info(`\n🧪 Testing Chat ${chatId} Context`);
  
  const testQuestions = [
    "What's my name?",
    "What do you know about me?",
    "Can you summarize our conversation?"
  ];

  for (const question of testQuestions) {
    console.log(`\nYou: ${question}`);
    
    try {
      const response = await axios.post(`${BASE_URL}/chat/${chatId}`, {
        messages: [{ role: 'user', parts: [{ type: 'text', text: question }] }]
      }, { responseType: 'stream' });

      let answer = '';
      
      response.data.on('data', (chunk) => {
        const lines = chunk.toString().split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6).trim();
            if (data !== '[DONE]') {
              try {
                const parsed = JSON.parse(data);
                if (parsed.textDelta) {
                  answer += parsed.textDelta;
                  process.stdout.write(parsed.textDelta);
                }
              } catch (e) {}
            }
          }
        }
      });

      await new Promise(resolve => response.data.on('end', resolve));
      console.log('\n');
      
    } catch (error) {
      console.log('❌ Error:', error.response?.data || error.message);
    }
    
    await delay(1500);
  }
}

// Get chat info
async function getChatInfo(chatId) {
  try {
    const response = await axios.get(`${BASE_URL}/chats/${chatId}`);
    logger.info(`\n📊 Chat ${chatId} Summary:`);
    logger.info(`Title: ${response.data.title}`);
    logger.info(`Total Messages: ${response.data.messages?.length}`);
    
    console.log('\nMessages:');
    response.data.messages?.forEach((msg, index) => {
      console.log(`${index + 1}. [${msg.role}] ${msg.content}`);
    });
    
  } catch (error) {
    logger.error('Error getting chat info:', error.response?.data || error.message);
  }
}

// Main function
async function main() {
  console.log('🚀 Creating Test Chats with Context\n');
  
  try {
    // Chat 1: Personal Context
    const chat1Messages = [
      "My name is John and I'm 30 years old",
      "I work as a doctor in Boston",
      "I love hiking and reading books"
    ];
    
    const chat1Id = await createChatWithMessages("John's Personal Chat", chat1Messages);
    await delay(2000);
    
    // Chat 2: Travel Context  
    const chat2Messages = [
      "I'm planning a trip to Paris next month",
      "I want to visit the Eiffel Tower and Louvre Museum",
      "I'm interested in French cuisine and art"
    ];
    
    const chat2Id = await createChatWithMessages("Paris Travel Chat", chat2Messages);
    await delay(2000);
    
    // Show chat info
    await getChatInfo(chat1Id);
    await delay(1000);
    
    await getChatInfo(chat2Id);
    await delay(1000);
    
    // Test context
    console.log('\n🎯 Testing Context Memory\n');
    
    await testChatContext(chat1Id, "John, 30, doctor, Boston, hiking, reading");
    await delay(2000);
    
    await testChatContext(chat2Id, "Paris, Eiffel Tower, Louvre, French cuisine, art");
    
    logger.success('\n🎉 All tests completed!');
    logger.info(`Chat 1 ID: ${chat1Id} (Personal Context)`);
    logger.info(`Chat 2 ID: ${chat2Id} (Travel Context)`);
    
  } catch (error) {
    logger.error('Test failed:', error);
  }
}

// Run the script
main();