import { createStep, createWorkflow } from "@mastra/core/workflows";

import { z } from "zod";

const step1 = createStep({
	id: "step-1",
	inputSchema: z.object({
		message: z.string(),
	}),
	outputSchema: z.object({
		formatted: z.string(),
	}),
	execute: async ({ inputData }) => {
		const { message } = inputData;

		return {
			formatted: message.toUpperCase(),
		};
	},
});

// const step1 = createStep({...});

// const step2 = createStep({
//   execute: async ({ inputData }) => {
//     const { number } = inputData;
//     return {
//       number: number + 1
//     };
//   }
// });

export const testWorkflow = createWorkflow({
	id: "test-workflow",
	inputSchema: z.object({
		message: z.string(),
	}),
	outputSchema: z.object({
		output: z.string(),
	}),
})
	.then(step1)
	.commit();
// .then(step1)
// .dountil(step2, async ({ inputData: { number } }) => number > 10)
// .commit();
