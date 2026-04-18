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
3. "scaffold": A working interactive ${language} logic scaffold that a student can manipulate to better understand the construct.
    - It should have the same outer structure as the original code (e.g. if the original code is a for-loop, the scaffold should also be a for-loop).
    - The scaffold should be complete, understandable, runnable code that demonstrates the same construct, but with all internal logic from the original code reference replaced by simplified examples.
    - The scaffold should be as minimal as possible while still being a valid example of the construct. Remove any extra functions, conditions, or logic that are not essential to demonstrating the construct.
    - The scaffold should be runnable and produce visible output, but it does NOT need to do anything meaningful. It is meant for educational purposes only.
    - If the original code is too complex to create a runnable scaffold, create a simplified version that captures the essence of the construct without all the complexity.
    - Include comments to help explain the structure and syntax of the scaffold
4. "runnable": A fully working ${language} program skeleton that allows the selected construct to be executed via the scaffold.
  For example, if a user is asking about a for-loop, the "runnable" code should include a complete program with the necessary setup to run the for-loop scaffold (e.g. if it's a Python for-loop, include the necessary imports and a main function to execute the loop). 
  The runnable code should be functional and demonstrate the construct in an executable way. 
  The user will never see runnable, so it can be more verbose and include extra setup or helper functions if needed to make the scaffold runnable
  demonstrates the SAME construct. 

The program will take the logic that the user manipulated in the scaffold and insert it into the runnable skeleton to create a complete program that they can run and test, based on the original code they asked about.

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
