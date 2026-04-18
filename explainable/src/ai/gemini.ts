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
The JSON must have exactly four keys: "title", "explanation", "scaffold", and "runnable".`;

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
Generate JSON with these 4 fields for the selected ${language} code:
"title": 3-5 word phrase describing what the code does. Be concrete; use actual names from the code when helpful.
"explanation": What the selected code does, in 3-5 sentences max:

Name the outer construct (loop, function, class, etc.) and its purpose.
Summarize the key steps inside it.
Note how it fits the larger file, if relevant.
Skip internal logic details, individual conditions, and implementation specifics.

"scaffold": A minimal, runnable ${language} snippet that teaches the same construct through a simplified example.

Match the outer structure of the original (if-elif-else → if-elif-else, for-loop → for-loop, etc.).
Replace ALL original logic with new, simple, concrete values — real variable names, real literals, real outputs. Never reproduce the original's specific conditions or data.
WRONG: commented pseudocode stubs like # return result for condition1. RIGHT: actual executable statements like return "low".
Keep it as short as possible while remaining a valid, complete demonstration of the construct.
Must produce visible output when run.
Add brief comments explaining structure and syntax.

"runnable": A complete ${language} program that wraps the scaffold for execution.

Include all setup needed to run (imports, boilerplate).
Place the exact string {{SCAFFOLD}} at the single insertion point where the scaffold code belongs. Include nothing else in that position.
The user never sees this — it runs behind the scenes with {{SCAFFOLD}} replaced by the student's edited scaffold.

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
