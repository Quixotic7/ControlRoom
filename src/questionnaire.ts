import { z } from "zod";
export const questionsSchema = z
  .array(
    z
      .object({
        id: z
          .string()
          .regex(/^[a-zA-Z0-9_-]+$/)
          .refine(
            (id) => !Object.hasOwn(Object.prototype, id),
            "Question ID is reserved",
          )
          .max(100),
        prompt: z.string().trim().min(1).max(5000),
        type: z.enum(["text", "choice"]),
        required: z.boolean().default(true),
        multiple: z.boolean().optional(),
        choices: z
          .array(z.string().trim().min(1).max(1000))
          .min(2)
          .max(30)
          .optional(),
        recommended: z.string().optional(),
      })
      .superRefine((q, ctx) => {
        if (q.type === "choice" && !q.choices)
          ctx.addIssue({ code: "custom", message: "Choices are required" });
        if (q.choices && new Set(q.choices).size !== q.choices.length)
          ctx.addIssue({ code: "custom", message: "Choices must be unique" });
        if (q.recommended && !q.choices?.includes(q.recommended))
          ctx.addIssue({
            code: "custom",
            message: "Recommendation must be a choice",
          });
      }),
  )
  .min(1)
  .max(30)
  .refine(
    (q) => new Set(q.map((i) => i.id)).size === q.length,
    "Question IDs must be unique",
  );
export type QuestionSpec = z.infer<typeof questionsSchema>;
export function questionText(questions: QuestionSpec) {
  return questions
    .map((q) => {
      const heading = `### ${q.id}: ${q.prompt}${q.required ? " (required)" : " (optional)"}`;
      if (q.type !== "choice") return `${heading}\n\nFree-text answer.`;
      const options = q
        .choices!.map(
          (c) => `- ${c}${c === q.recommended ? " (recommended)" : ""}`,
        )
        .join("\n");
      const mode = q.multiple ? "Select all that apply." : "Select one option.";
      return `${heading}\n\n${options}\n\n${mode} Custom text is separate and also welcome.`;
    })
    .join("\n\n");
}

export const choiceAnswersSchema = z.record(
  z.string(),
  z
    .object({
      selected: z.array(z.string()).max(30),
      custom: z.string().trim().max(10000),
    })
    .strict(),
);
export type ChoiceAnswers = z.infer<typeof choiceAnswersSchema>;
