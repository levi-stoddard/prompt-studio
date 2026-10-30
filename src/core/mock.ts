import type { GenerateRequest, GenerateResult, LlmProvider, PromptPayload, ProviderResult, ReviseRequest, ReviseResult, Usage } from './types';

// Deterministic offline optimizer used for development, tests and when no Gemini key is configured.
// It never makes a network call and is never billed.

export const MOCK_MODEL = 'mock-optimizer (offline, no cost)';

function usageFor(p: PromptPayload, out: string): Usage {
  return { inputTokens: Math.ceil((p.system.length + p.user.length) / 4), outputTokens: Math.ceil(out.length / 4), thinkingTokens: 0 };
}

function sections(req: GenerateRequest): [string, string][] {
  const ruleLines = req.rules.filter((r) => !r.protected).map((r) => `- ${r.body}`);
  const context = [
    req.projectName ? `This request belongs to the project "${req.projectName}".` : 'This is a general request (no specific project).',
    ...req.excerpts.map((e) => `Reference document provided: ${e.label}`),
  ].join('\n');
  return [
    ['role', `You are an expert assistant. Work carefully and precisely on the task below.`],
    ['context', context],
    ['task', req.original.trim()],
    ['requirements', ['- Address every part of the task completely.', '- State any assumptions you make.', ...ruleLines].join('\n')],
    ['output_format', 'Respond with a clear, well-structured answer. Use headings and lists where they aid readability. Ask clarifying questions first if critical information is missing.'],
  ];
}

function render(req: GenerateRequest): string {
  const s = sections(req);
  if (req.target.format === 'xml') return s.map(([k, v]) => `<${k}>\n${v}\n</${k}>`).join('\n\n');
  const title = (k: string) => k.replace('_', ' ').replace(/^./, (c) => c.toUpperCase());
  return s.map(([k, v]) => `## ${title(k)}\n${v}`).join('\n\n');
}

export class MockProvider implements LlmProvider {
  id = 'mock' as const;

  async generate(req: GenerateRequest, payload: PromptPayload): Promise<ProviderResult<GenerateResult>> {
    const optimizedPrompt = `${render(req)}`;
    const recommendations =
      req.mode === 'challenge'
        ? [
            {
              title: 'Define measurable success criteria',
              rationale: 'The instruction does not say how the result will be judged. Explicit criteria make the output easier to verify.',
              findText: '',
              replacementText:
                req.target.format === 'xml'
                  ? '<success_criteria>\n- List the specific, checkable criteria the result must meet.\n</success_criteria>'
                  : '## Success criteria\n- List the specific, checkable criteria the result must meet.',
            },
            {
              title: 'Ask for alternatives before committing',
              rationale: 'A short comparison of two or three approaches can reveal a cheaper or lower-risk path.',
              findText: '- State any assumptions you make.',
              replacementText: '- State any assumptions you make.\n- Before committing to one approach, briefly compare two or three alternatives and recommend one.',
            },
          ]
        : [];
    const conflicts =
      /without (my )?approval|skip (the )?approval/i.test(req.original) && req.rules.some((r) => r.protected && /approval/i.test(r.body))
        ? [{ ruleTitle: req.rules.find((r) => r.protected && /approval/i.test(r.body))!.title, issue: 'The instruction asks to proceed without approval, which conflicts with a protected rule.', suggestion: 'Keep the approval requirement, or edit the protected rule yourself.' }]
        : [];
    const data: GenerateResult = {
      optimizedPrompt,
      changes: [
        { kind: 'structured', description: `Organized the request into ${req.target.format === 'xml' ? 'XML-tagged' : 'headed'} sections for ${req.target.name}.` },
        { kind: 'added_detail', description: 'Added explicit requirements and an output format.' },
      ],
      recommendations,
      conflicts,
      questions: req.original.trim().length < 80 ? ['What output format and length do you want?'] : [],
    };
    return { data, usage: usageFor(payload, optimizedPrompt), model: MOCK_MODEL };
  }

  async revise(req: ReviseRequest, payload: PromptPayload): Promise<ProviderResult<ReviseResult>> {
    const notes = [...req.comments.map((c) => c.body), ...(req.instruction ? [req.instruction] : [])];
    let revisedText: string;
    if (req.selection) {
      revisedText = `${req.selection.text.trim()} [revised: ${notes.join('; ') || 'clarified'}]`;
    } else {
      const block = req.target.format === 'xml' ? `<revision_notes>\n${notes.map((n) => `- ${n}`).join('\n')}\n</revision_notes>` : `## Revision notes\n${notes.map((n) => `- ${n}`).join('\n')}`;
      revisedText = notes.length ? `${req.current.trimEnd()}\n\n${block}` : req.current;
    }
    return {
      data: { revisedText, changes: [{ kind: 'revised', description: `Applied ${notes.length} reviewer note(s) (offline mock).` }], conflicts: [] },
      usage: usageFor(payload, revisedText),
      model: MOCK_MODEL,
    };
  }
}
