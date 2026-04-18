import { GoogleGenerativeAI } from '@google/generative-ai';

export interface GeminiResult {
  title: string;
  explanation: string;
  scaffold: string;
  runnable: string;
}

const MODEL = 'gemini-2.5-flash';

const SYSTEM_PROMPT = `You are a patient CS tutor helping students understand code they did not write. Be concise and clear, and 
focus on the big picture topics.
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
1. "title": A 3-5 word phrase describing what this specific code block does (e.g. "fetch user data from API", "recursive binary search function", "filter even numbers from list"). Be concrete — use actual variable or function names if helpful.
2. "explanation": describe what the SELECTED CODE does at a high level in 3 sections: 
  a) Name the outer construct (loop, class, function, etc.) and its overall purpose. 
  b) Describe the key steps or components inside the construct. 
  c) Explain how it fits into the larger file or project context, if relevant. Do NOT explain internal logic, individual conditions, or implementation details.
  DO NOT exceed 5 sentences in total, and keep it as concise as possible while still being clear.

In 2-3 sentences, describe what the SELECTED CODE does at a high level. Name the outer construct (loop, class, function, etc.) and its overall purpose. Do NOT explain internal logic, individual conditions, or implementation details.
3. "scaffold": A visual outline of the construct for display only — NOT runnable code. Show the outer shell (opening line + closing brace/keyword) with the entire body replaced by a plain-English comment describing what goes inside. Use the same construct type as the original. Maximum 5 lines. Example for a for-loop: "for (int i = 0; i < n; i++) {\n    // repeat this block n times\n}"
4. "runnable": A fully working ${language} program that demonstrates the SAME construct. Rules:
   - Use the same construct type (for-loop → for-loop, class → class, etc.)
   - Use small hardcoded values (loop 3 times, a list of 3 items, etc.)
   - The body does ONE simple thing (print the counter, print each item, etc.)
   - No imports unless absolutely required by the language, no helper functions
   - Must run to completion and produce visible output. Maximum 10 lines.

Respond with ONLY this JSON (no markdown fences, no extra keys):
{"title": "...", "explanation": "...", "scaffold": "...", "runnable": "..."}`;
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
      runnable: typeof parsed.runnable === 'string' ? parsed.runnable : parsed.scaffold,
    };
  } catch {
    return {
      title: 'code snippet',
      explanation: raw,
      scaffold: `// Could not generate example`,
      runnable: '',
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
