"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.explainCode = explainCode;
const generative_ai_1 = require("@google/generative-ai");
const MODEL = 'gemini-2.0-flash';
const SYSTEM_PROMPT = `You are a patient CS tutor helping students understand code they did not write.
You must respond ONLY with valid JSON — no markdown, no prose outside the JSON object.
The JSON must have exactly two keys: "explanation" and "scaffold".`;
function buildPrompt(code, language, fileContext) {
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
1. "explanation": Explain what the SELECTED CODE does in plain English. Focus on the highest-level construct present (if it is a loop, explain the loop; if it is a class, explain the class; if it is a function call, explain what it does in context). Assume the student knows variables, functions, and basic data types but may not know this specific pattern. Maximum 150 words. Be concrete — mention the actual variable names and values from the code.
2. "scaffold": Write a minimal bare-bones ${language} example of the SAME construct type. Do NOT copy the original code. Use generic names (items, result, callback, etc.). Add short TODO comments showing where the student should put their own logic. Maximum 20 lines.

Respond with ONLY this JSON (no markdown fences, no extra keys):
{"explanation": "...", "scaffold": "..."}`;
}
function parseResult(raw) {
    const cleaned = raw
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/```\s*$/i, '')
        .trim();
    try {
        const parsed = JSON.parse(cleaned);
        if (typeof parsed.explanation !== 'string' || typeof parsed.scaffold !== 'string') {
            throw new Error('Missing explanation or scaffold field');
        }
        return { explanation: parsed.explanation, scaffold: parsed.scaffold };
    }
    catch {
        return {
            explanation: raw,
            scaffold: `# Could not generate scaffold\n# Raw response shown in explanation\n`,
        };
    }
}
async function explainCode(code, language, fileContext, apiKey) {
    if (!apiKey) {
        throw new Error('Gemini API key not set. Go to Settings → search "Explainable" → enter your API key.');
    }
    const genAI = new generative_ai_1.GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
        model: MODEL,
        systemInstruction: SYSTEM_PROMPT,
    });
    const result = await model.generateContent(buildPrompt(code, language, fileContext));
    const raw = result.response.text();
    return parseResult(raw);
}
//# sourceMappingURL=gemini.js.map