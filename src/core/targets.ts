import type { TargetProfile } from './types';

// Guidance describes formatting conventions each assistant handles well. It deliberately avoids
// product features (tools, memory, custom GPTs, projects) that a pasted prompt cannot rely on.
export const BUILTIN_TARGETS: TargetProfile[] = [
  {
    id: 'chatgpt',
    name: 'ChatGPT',
    url: 'https://chatgpt.com/',
    format: 'markdown',
    builtin: true,
    guidance: [
      'Format for ChatGPT as a single pasted chat message.',
      'Use short Markdown headings in this order: Role, Goal, Context, Requirements, Constraints, Output format.',
      'State the deliverable and the definition of done explicitly. Use numbered steps where order matters.',
      'Ask the assistant to state assumptions and to ask clarifying questions before proceeding if critical information is missing.',
      'Do not reference tools, browsing, memory or file uploads unless the user said they will provide them.',
    ].join('\n'),
  },
  {
    id: 'claude',
    name: 'Claude',
    url: 'https://claude.ai/new',
    format: 'xml',
    builtin: true,
    guidance: [
      'Format for Claude as a single pasted chat message.',
      'Claude follows XML-tagged sections well: use <role>, <context>, <task>, <requirements>, <constraints> and <output_format> tags.',
      'Put long reference material in its own tagged section before the task, and the task and questions after it.',
      'Be direct and specific; explain why important constraints exist so they can be applied with judgment.',
      'Do not reference tools, projects, memory or file uploads unless the user said they will provide them.',
    ].join('\n'),
  },
  {
    id: 'gemini',
    name: 'Gemini',
    url: 'https://gemini.google.com/app',
    format: 'markdown',
    builtin: true,
    guidance: [
      'Format for the Gemini app as a single pasted chat message.',
      'Use clear Markdown headings: Role, Context, Task, Constraints, Output format.',
      'Place supporting context before the task, and end with the specific request and the expected format.',
      'Be explicit about length, structure and level of detail.',
      'Do not reference extensions, Gems, Workspace data or file uploads unless the user said they will provide them.',
    ].join('\n'),
  },
];
