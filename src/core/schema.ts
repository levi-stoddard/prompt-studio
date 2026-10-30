import { z } from 'zod';
import type { GenerateResult, ReviseResult } from './types';

// JSON Schemas sent to Gemini as responseJsonSchema; zod re-validates whatever comes back.

const changeSchema = {
  type: 'object',
  properties: { kind: { type: 'string' }, description: { type: 'string' } },
  required: ['kind', 'description'],
};
const conflictSchema = {
  type: 'object',
  properties: { rule_title: { type: 'string' }, issue: { type: 'string' }, suggestion: { type: 'string' } },
  required: ['rule_title', 'issue', 'suggestion'],
};

export const GENERATE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    optimized_prompt: { type: 'string' },
    change_summary: { type: 'array', items: changeSchema },
    recommendations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          rationale: { type: 'string' },
          find_text: { type: 'string' },
          replacement_text: { type: 'string' },
        },
        required: ['title', 'rationale', 'find_text', 'replacement_text'],
      },
    },
    conflicts: { type: 'array', items: conflictSchema },
    open_questions: { type: 'array', items: { type: 'string' } },
  },
  required: ['optimized_prompt', 'change_summary', 'recommendations', 'conflicts', 'open_questions'],
};

export const REVISE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    revised_text: { type: 'string' },
    change_summary: { type: 'array', items: changeSchema },
    conflicts: { type: 'array', items: conflictSchema },
  },
  required: ['revised_text', 'change_summary', 'conflicts'],
};

const zChange = z.object({ kind: z.string(), description: z.string() });
const zConflict = z.object({ rule_title: z.string(), issue: z.string(), suggestion: z.string() });

const zGenerate = z.object({
  optimized_prompt: z.string().min(1),
  change_summary: z.array(zChange).default([]),
  recommendations: z
    .array(z.object({ title: z.string(), rationale: z.string(), find_text: z.string().default(''), replacement_text: z.string() }))
    .default([]),
  conflicts: z.array(zConflict).default([]),
  open_questions: z.array(z.string()).default([]),
});

const zRevise = z.object({
  revised_text: z.string().min(1),
  change_summary: z.array(zChange).default([]),
  conflicts: z.array(zConflict).default([]),
});

const mapConflicts = (c: z.infer<typeof zConflict>[]) => c.map((x) => ({ ruleTitle: x.rule_title, issue: x.issue, suggestion: x.suggestion }));

export function parseGenerate(json: string): GenerateResult {
  const d = zGenerate.parse(JSON.parse(json));
  return {
    optimizedPrompt: d.optimized_prompt,
    changes: d.change_summary,
    recommendations: d.recommendations.map((r) => ({ title: r.title, rationale: r.rationale, findText: r.find_text, replacementText: r.replacement_text })),
    conflicts: mapConflicts(d.conflicts),
    questions: d.open_questions,
  };
}

export function parseRevise(json: string): ReviseResult {
  const d = zRevise.parse(JSON.parse(json));
  return { revisedText: d.revised_text, changes: d.change_summary, conflicts: mapConflicts(d.conflicts) };
}
