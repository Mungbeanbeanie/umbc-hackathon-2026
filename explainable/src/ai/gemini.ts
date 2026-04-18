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
1. "title": A 4-6 word phrase describing what this specific code block does (e.g. "fetch user data from API", "recursive binary search function", "filter even numbers from list"). Be concrete — use actual variable or function names if helpful.
2. "explanation": In 2-3 sentences, describe what the SELECTED CODE does at a high level. Name the outer construct (loop, class, function, etc.) and its overall purpose. Do NOT explain internal logic, individual conditions, or implementation details.
3. "scaffold": Display version — copy the EXACT outer construct signature from the SELECTED CODE (real variable names, real bounds, real parameters — do not simplify). Replace ONLY the body with one or two plain-English pseudo-code comments describing what the body does at a high level. Do not add any executable statements. Maximum 8 lines. Example: if the original is "for (int i = 0; i < arr.length; i++) { result += arr[i]; }" then scaffold is "for (int i = 0; i < arr.length; i++) {\n    // add each element to result\n}"
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
