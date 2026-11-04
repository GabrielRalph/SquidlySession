import { serve } from "@hono/node-server";
import { zValidator } from "@hono/zod-validator";
import { asClass, asValue, createContainer, InjectionMode } from "awilix";
import { Hono } from "hono";
import { z } from "zod";
import { agent } from "./agents/agent.js";

import { AgentService } from "./services/agent.service.js";

const app = new Hono();

const container = createContainer({
	injectionMode: InjectionMode.CLASSIC,
	strict: true,
});

container.register({
	agent: asValue(agent),
	agentService: asClass(AgentService).singleton(),
});

app.get("/", (c) => {
	return c.text("Hello Hono!");
});

app.post(
	"/agent",
	zValidator(
		"json",
		z.object({
			query: z.string(),
		}),
	),
	async (c) => {
		const { query } = c.req.valid("json");

		const agentService = container.resolve<AgentService>("agentService");
		const result = await agentService.generateBoard(query, "user_abc");

		return c.json({
			message: result,
		});
	},
);

serve(
	{
		fetch: app.fetch,
		port: 3000,
	},
	(info) => {
		console.log(`Server is running on http://localhost:${info.port}`);
	},
);
