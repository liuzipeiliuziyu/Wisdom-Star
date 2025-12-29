
import { GoogleGenAI, Type, Modality } from "@google/genai";
import { Question, Grade, Subject, QuestionType } from "../types";

export class GeminiService {
  private ai: GoogleGenAI;

  constructor() {
    this.ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
  }

  private async callWithRetry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error: any) {
      const msg = error.message?.toLowerCase() || "";
      if (msg.includes("429") || msg.includes("quota")) {
        if (msg.includes("daily") || msg.includes("exhausted")) {
          throw new Error("DAILY_QUOTA_EXCEEDED");
        }
        throw new Error("RATE_LIMIT_EXCEEDED");
      }
      throw error;
    }
  }

  async generateQuestion(grade: Grade, subject: Subject, topic?: string): Promise<Question> {
    return this.callWithRetry(async () => {
      const topicConstraint = topic ? `【重点话题】：${topic}（需完美融入学科背景）。` : "";
      
      const subjectRules = {
        Math: `这是一道【数学】题。考察：运算、应用逻辑、图形。绝对禁止：诗词、英语。`,
        Chinese: `这是一道【语文】题。考察：汉字词语、古诗、造句。绝对禁止：纯数学计算、长篇英语。`,
        English: `这是一道【英语】题。考察：单词辨析、语法、翻译。绝对禁止：数学方程、中文古文。`
      }[subject];

      const prompt = `你是一名专业小学教师。请为 ${grade} 年级学生出一道 ${subject} 题。
      ${subjectRules} ${topicConstraint}
      返回 JSON 格式：type('choice'|'input'), text, options(array), correctIndex(number), points(3,5,7), explanation, visualPrompt, sampleAnswer。`;

      const response = await this.ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ parts: [{ text: prompt }] }],
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              type: { type: Type.STRING },
              text: { type: Type.STRING },
              options: { type: Type.ARRAY, items: { type: Type.STRING }, nullable: true },
              correctIndex: { type: Type.NUMBER, nullable: true },
              sampleAnswer: { type: Type.STRING, nullable: true },
              points: { type: Type.NUMBER },
              explanation: { type: Type.STRING },
              visualPrompt: { type: Type.STRING }
            },
            required: ["type", "text", "points", "explanation", "visualPrompt"]
          }
        }
      });

      const data = JSON.parse(response.text);
      return { ...data, id: Math.random().toString(36).substr(2, 9) };
    });
  }

  async verifyAnswer(questionText: string, userAnswer: string, sampleAnswer: string): Promise<{ isCorrect: boolean, feedback: string }> {
    return this.callWithRetry(async () => {
      const prompt = `题目：${questionText} 参考答案：${sampleAnswer} 学生答案：${userAnswer}。判断正误并给出一句点评。返回 JSON: {isCorrect: boolean, feedback: string}`;
      const response = await this.ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: [{ parts: [{ text: prompt }] }],
        config: { 
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              isCorrect: { type: Type.BOOLEAN },
              feedback: { type: Type.STRING }
            },
            required: ["isCorrect", "feedback"]
          }
        }
      });
      return JSON.parse(response.text);
    });
  }

  async generateVisual(prompt: string): Promise<string | null> {
    try {
      const response = await this.ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
          parts: [{ text: `High quality 3D Disney Pixar style character or object: ${prompt}` }]
        },
        config: { imageConfig: { aspectRatio: "1:1" } }
      });
      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) return `data:image/png;base64,${part.inlineData.data}`;
      }
    } catch (e) {
      console.warn("Visual gen failed - using fallback:", e);
    }
    return null;
  }

  async generateSpeech(text: string): Promise<string | null> {
    try {
      const response = await this.ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: `请用温柔亲切的语气朗读这道题目：${text}` }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Kore' }, // Kore sounds friendly
            },
          },
        },
      });
      return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || null;
    } catch (e) {
      console.warn("Speech generation failed:", e);
      return null;
    }
  }
}
