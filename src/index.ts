import express from "express";
import bodyParser from "body-parser";
import { ChatMistralAI } from "@langchain/mistralai";
import { ChatPromptTemplate } from "@langchain/core/prompts";
import { toUIMessageStream } from "@ai-sdk/langchain";
import { createUIMessageStreamResponse } from "ai";
import dotenv from "dotenv";
import cors from "cors";

dotenv.config();

const app = express();
app.use(bodyParser.json());
app.use(
  cors({
    origin: "http://localhost:5173",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
  })
);

app.post("/chat", async (req, res) => {
  try {
    const { messages } = req.body;

    const normalizedMessages = (messages || []).map((m: any) => {
      const textPart = m.parts?.[0]?.text || "";
      return { role: m.role, content: textPart };
    });

    const model = new ChatMistralAI({
      apiKey: process.env.OPENROUTER_API_KEY!,
      model: "mistralai/mistral-small-3.2-24b-instruct:free",
      temperature: 0.7,
      streaming: true,
      serverURL: "https://openrouter.ai/api",
      beforeRequestHooks: [
        async (request) => {
          request.headers.set("HTTP-Referer", "http://localhost:3000");
          request.headers.set("X-Title", "LangChain Agent");
          return request;
        },
      ],
    });

    const prompt = ChatPromptTemplate.fromMessages([
      ["system", "You are a clear, direct assistant."],
      ...normalizedMessages.map((m:any) => [m.role, m.content]),
    ]);

    const chain = prompt.pipe(model);
    const stream = await chain.stream({});

    const response = createUIMessageStreamResponse({
      stream: toUIMessageStream(stream),
    });

    res.set({
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    if (!response.body) {
      res.status(500).send("No response body");
      return;
    }

    for await (const chunk of response.body as any) {
      res.write(chunk);
    }
    res.end();
  } catch (err: any) {
    console.error("Error in /chat:", err);
    res.status(500).json({
      error: "Internal Server Error",
      details: err.message,
    });
  }
});

app.listen(3000, () => {
  console.log("⚡ AI Agent backend running on http://localhost:3000");
});
