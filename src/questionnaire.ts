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
    .map(
      (q) =>
        `### ${q.id}: ${q.prompt}${q.required ? " (required)" : " (optional)"}\n\n${q.type === "choice" ? q.choices!.map((c) => `- ${c}${c === q.recommended ? " (recommended)" : ""}`).join("\n") + "\n\nCustom text is also welcome." : "Free-text answer."}`,
    )
    .join("\n\n");
}
