import { GoogleGenerativeAI } from '@google/generative-ai';

export interface GeminiResult {
  title: string;
  explanation: string;
  scaffold: string;
}

const MODEL = 'gemini-2.5-flash';

const SYSTEM_PROMPT = `You are a patient CS tutor helping students understand code they did not write.
You must respond ONLY with valid JSON — no markdown, no prose outside the JSON object.
The JSON must have exactly three keys: "title", "explanation", and "scaffold".`;

function buildPrompt(code: string, language: string, fileContext: string): string {
  const contextSnippet = fileContext.slice(0, 3000);
  return `Language: ${language}

SELECTED CODE:
\`\`\`${language}
${code}
\`\`\`

SURROUNDING FILE CONTEXT (for reference only):
\`\`\`${language}
${contextSnippet}
\`\`\`

Instructions:
1. "title": A 4-6 word phrase describing what this specific code block does (e.g. "fetch user data from API", "recursive binary search function", "filter even numbers from list"). Be concrete — use actual variable or function names if helpful.
2. "explanation": Explain what the SELECTED CODE does in plain English. Focus on the highest-level construct present (if it is a loop, explain the loop; if it is a class, explain the class; if it is a function call, explain what it does in context). Assume the student knows variables, functions, and basic data types but may not know this specific pattern. Maximum 150 words. Be concrete — mention the actual variable names and values from the code.
3. "scaffold": Write a minimal bare-bones ${language} example of the SAME construct type. Do NOT copy the original code. Use generic names (items, result, callback, etc.). Add short TODO comments showing where the student should put their own logic. Maximum 20 lines.

Respond with ONLY this JSON (no markdown fences, no extra keys):
{"title": "...", "explanation": "...", "scaffold": "..."}`;
}

function parseResult(raw: string): GeminiResult {
  const cleaned = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();
  try {
    const parsed = JSON.parse(cleaned) as Record<string, unknown>;
    if (typeof parsed.explanation !== 'string' || typeof parsed.scaffold !== 'string') {
      throw new Error('Missing explanation or scaffold field');
    }
    return {
      title: typeof parsed.title === 'string' ? parsed.title : 'code snippet',
      explanation: parsed.explanation,
      scaffold: parsed.scaffold,
    };
  } catch (err) {
    console.warn('[Explainable] parseResult fallback triggered:', err instanceof Error ? err.message : String(err));
    return {
      title: 'code snippet',
      explanation: raw,
      scaffold: `# Could not generate scaffold\n# Raw response shown in explanation\n`,
    };
  }
}

export async function explainCode(
  code: string,
  language: string,
  fileContext: string,
  apiKey: string
): Promise<GeminiResult> {
  if (!apiKey) {
    throw new Error(
      'Gemini API key not set. Go to Settings → search "Explainable" → enter your API key.'
    );
  }
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: MODEL,
    systemInstruction: SYSTEM_PROMPT,
  });
  const result = await model.generateContent(buildPrompt(code, language, fileContext));
  const raw = result.response.text();
  return parseResult(raw);
}
