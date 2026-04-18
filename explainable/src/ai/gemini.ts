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
1. "title": A 3-5 word phrase describing what this specific code block does (e.g. "fetch user data from API", "recursive binary search function", "filter even numbers from list"). Be concrete — use actual variable or function names if helpful.
2. "explanation": describe what the SELECTED CODE does at a high level in 3 sections: 
  a) Name the outer construct (loop, class, function, etc.) and its overall purpose. 
  b) Describe the key steps or components inside the construct. 
  c) Explain how it fits into the larger file or project context, if relevant. Do NOT explain internal logic, individual conditions, or implementation details.
  DO NOT exceed 5 sentences in total, and keep it as concise as possible while still being clear.
3. "scaffold": A working interactive ${language} logic scaffold that a student can manipulate to better understand the construct.
    - It should have the same outer structure as the original code (e.g. if the original code is a for-loop, the scaffold should also be a for-loop).
    - The scaffold should be runnable code that demonstrates the same construct, but with all internal logic stripped out and replaced with placeholders or simplified examples.
    - The scaffold should be as minimal as possible while still being a valid example of the construct. Remove any extra functions, conditions, or logic that are not essential to demonstrating the construct.
    - The scaffold should be runnable and produce visible output, but it does NOT need to do anything meaningful. It is meant for educational purposes only.
    - If the original code is too complex to create a runnable scaffold, create a simplified version that captures the essence of the construct without all the complexity.
    - Include comments to help explain the structure and syntax of the scaffold
4. "runnable": A complete ${language} program that wraps the scaffold. Rules:
  - Include all necessary setup (imports, variable declarations, main function/class boilerplate) so the scaffold can execute.
  - Place the exact literal string {{SCAFFOLD}} at the single point where the scaffold code should be inserted — no other placeholder text.
  - Do NOT include any copy of the scaffold logic itself; {{SCAFFOLD}} is the only stand-in for it.
  - The surrounding setup should use small hardcoded values (e.g. a list of 3 items, a counter up to 5) that match what the scaffold expects.
  - The user never sees runnable — it is only used at run time by replacing {{SCAFFOLD}} with whatever the student wrote in the scaffold editor.

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
