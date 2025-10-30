import axios from 'axios';
import fs from 'fs';

// Configure logging for chat flow only
const logStream = fs.createWriteStream('chat_flow_fixed.log', { flags: 'a' });
const logChatFlow = (chatId, action, message = null, isAI = false) => {
  const prefix = isAI ? '🤖 AI' : '👤 User';
  logStream.write(
    `[${new Date().toISOString()}] ` +
    `Chat ${chatId} (${prefix}): ${action}` +
    (message ? ` | "${message}"` : '') + '\n'
  );
};

const API_BASE_URL = 'http://localhost:3000';

async function runChatFlowTest() {
  let chatId1, chatId2, chatId3;

  // Step 1: Create 3 chats
  logChatFlow('N/A', '=== Starting Chat Flow Test ===');
  const res1 = await axios.post(`${API_BASE_URL}/chats`, { title: 'Project Discussion' });
  chatId1 = res1.data.id;
  logChatFlow(chatId1, 'Created');

  const res2 = await axios.post(`${API_BASE_URL}/chats`, { title: 'Bug Triage' });
  chatId2 = res2.data.id;
  logChatFlow(chatId2, 'Created');

  const res3 = await axios.post(`${API_BASE_URL}/chats`, { title: 'New Feature Brainstorm' });
  chatId3 = res3.data.id;
  logChatFlow(chatId3, 'Created');

  // Step 2: Send first messages to all chats
  await axios.post(`${API_BASE_URL}/chat/${chatId1}`, {
    messages: [{ role: 'user', content: 'What’s the timeline for Project X?' }]
  });
  logChatFlow(chatId1, 'Message sent', 'What’s the timeline for Project X?');

  await axios.post(`${API_BASE_URL}/chat/${chatId2}`, {
    messages: [{ role: 'user', content: 'Why is the login API failing?' }]
  });
  logChatFlow(chatId2, 'Message sent', 'Why is the login API failing?');

  await axios.post(`${API_BASE_URL}/chat/${chatId3}`, {
    messages: [{ role: 'user', content: 'How should we design the new dashboard?' }]
  });
  logChatFlow(chatId3, 'Message sent', 'How should we design the new dashboard?');

  // Step 3: Fetch and log AI responses (if any)
  const chat1Messages1 = (await axios.get(`${API_BASE_URL}/chats/${chatId1}`)).data.messages;
  if (chat1Messages1.length > 1 && chat1Messages1[1].role === 'assistant') {
    logChatFlow(chatId1, 'AI response', chat1Messages1[1].content, true);
  } else {
    logChatFlow(chatId1, 'AI response', '(No response)', true);
  }

  const chat2Messages1 = (await axios.get(`${API_BASE_URL}/chats/${chatId2}`)).data.messages;
  if (chat2Messages1.length > 1 && chat2Messages1[1].role === 'assistant') {
    logChatFlow(chatId2, 'AI response', chat2Messages1[1].content, true);
  } else {
    logChatFlow(chatId2, 'AI response', '(No response)', true);
  }

  const chat3Messages1 = (await axios.get(`${API_BASE_URL}/chats/${chatId3}`)).data.messages;
  if (chat3Messages1.length > 1 && chat3Messages1[1].role === 'assistant') {
    logChatFlow(chatId3, 'AI response', chat3Messages1[1].content, true);
  } else {
    logChatFlow(chatId3, 'AI response', '(No response)', true);
  }

  // Step 4: Send follow-up messages
  await axios.post(`${API_BASE_URL}/chat/${chatId1}`, {
    messages: [{ role: 'user', content: 'Can we get it done by Friday?' }]
  });
  logChatFlow(chatId1, 'Follow-up sent', 'Can we get it done by Friday?');

  await axios.post(`${API_BASE_URL}/chat/${chatId2}`, {
    messages: [{ role: 'user', content: 'Is it a backend or frontend issue?' }]
  });
  logChatFlow(chatId2, 'Follow-up sent', 'Is it a backend or frontend issue?');

  await axios.post(`${API_BASE_URL}/chat/${chatId3}`, {
    messages: [{ role: 'user', content: 'Should we use charts or tables?' }]
  });
  logChatFlow(chatId3, 'Follow-up sent', 'Should we use charts or tables?');

  // Step 5: Final context check (only log message count)
  const finalChat1 = (await axios.get(`${API_BASE_URL}/chats/${chatId1}`)).data;
  logChatFlow(chatId1, 'Final context', `Total messages: ${finalChat1.messages.length}`);

  const finalChat2 = (await axios.get(`${API_BASE_URL}/chats/${chatId2}`)).data;
  logChatFlow(chatId2, 'Final context', `Total messages: ${finalChat2.messages.length}`);

  const finalChat3 = (await axios.get(`${API_BASE_URL}/chats/${chatId3}`)).data;
  logChatFlow(chatId3, 'Final context', `Total messages: ${finalChat3.messages.length}`);

  logChatFlow('N/A', '=== Chat Flow Test Completed ===');
}

runChatFlowTest().catch(err => logStream.write(`[ERROR] Test failed: ${err.message}\n`));
