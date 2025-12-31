import { GoogleGenAI, Type, Modality } from "@google/genai";
import { Question, Grade, Subject } from "../types";

export class GeminiService {
  private ai: GoogleGenAI;

  constructor() {
    const apiKey = (process.env as any).API_KEY || "";
    this.ai = new GoogleGenAI({ apiKey });
  }

  private async callWithRetry<T>(fn: () => Promise<T>): Promise<T> {
    if (!(process.env as any).API_KEY) {
      throw new Error("MISSING_API_KEY");
    }
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
      
      // 针对不同学段优化英语出题策略
      const isLowGrade = grade <= 2;
      
      const subjectRules = {
        Math: `这是一道【数学】题。考察：运算、应用逻辑、图形。要求描述生动形象。`,
        Chinese: `这是一道【语文】题。考察：汉字、拼音、古诗、成语。要求适合${grade}年级水平。`,
        English: `这是一道【英语】题。${
          isLowGrade 
          ? "【重要】：由于是 1-2 年级小朋友，请务必使用【中文】来描述题目要求（例如：'请选出图中动物的英文名字'），确保孩子能听懂要做什么。考察重点：基础单词（动物、水果、颜色）、字母认读、简单问候语。" 
          : "考察重点：语法、词组应用、阅读理解、翻译。"
        } 绝对禁止：数学方程、中文古文。`
      }[subject];

      const prompt = `你是一名风趣幽默的小学老师。请为 ${grade} 年级学生出一道 ${subject} 题。
      ${subjectRules} ${topicConstraint}
      【要求】：
      1. 题目内容（text 字段）要亲切、简短。
      2. 如果是英语题且是低年级，用中文问，选项用英文。
      3. 【视觉绘图要求】：visualPrompt 必须是一个具体的、3D 风格的具象场景描述，严禁包含任何文字、公式、符号或抽象概念。
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

      const text = response.text || "{}";
      const data = JSON.parse(text);
      return { ...data, id: Math.random().toString(36).substr(2, 9) };
    });
  }

  async verifyAnswer(questionText: string, userAnswer: string, sampleAnswer: string): Promise<{ isCorrect: boolean, feedback: string }> {
    return this.callWithRetry(async () => {
      const prompt = `题目：${questionText} 参考答案：${sampleAnswer} 学生答案：${userAnswer}。判断正误并给出一句鼓励性点评。返回 JSON: {isCorrect: boolean, feedback: string}`;
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
      const text = response.text || "{}";
      return JSON.parse(text);
    });
  }

  async generateVisual(prompt: string): Promise<string | null> {
    try {
      if (!(process.env as any).API_KEY) return null;
      const enhancedPrompt = `High quality 3D Disney Pixar style character or object, vibrant colors, clear focus, studio lighting, cute and kid-friendly: ${prompt}`;
      
      const response = await this.ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
          parts: [{ text: enhancedPrompt }]
        },
        config: { 
          imageConfig: { aspectRatio: "1:1" } 
        }
      });

      const candidates = response.candidates?.[0]?.content?.parts || [];
      for (const part of candidates) {
        if (part.inlineData?.data) {
          return `data:image/png;base64,${part.inlineData.data}`;
        }
      }
      return null;
    } catch (e) {
      console.warn("Visual gen failed:", e);
      return null;
    }
  }

  async generateSpeech(text: string): Promise<string | null> {
    try {
      if (!(process.env as any).API_KEY) return null;
      const response = await this.ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: `请用温柔、语速稍慢的亲切语气朗读这道题目：${text}` }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: { voiceName: 'Kore' },
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