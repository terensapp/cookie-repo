import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod/v4"; // the SDK's output-format helper reads Zod 4 schemas

export const UNITS = ["", "tsp", "tbsp", "cup", "g", "kg", "oz", "lb", "ml", "l", "stick", "each", "pinch"];
export const CATS = ["Baking staples", "Dairy & eggs", "Sugar & sweeteners", "Mix-ins", "Spices & extracts", "Produce", "Other"];

const Recipe = z.object({
  isRecipe: z.boolean().describe("false if the source holds no cookie or baking recipe"),
  problem: z.string().describe("why no recipe could be read; empty when isRecipe is true"),
  name: z.string(),
  yieldCount: z.number().describe("cookies the recipe makes as written"),
  ingredients: z.array(z.object({
    qty: z.number().nullable().describe("decimal amount; 2 1/4 -> 2.25; null for 'to taste'"),
    unit: z.enum(UNITS),
    item: z.string().describe("short shopping name, lowercase, e.g. 'all-purpose flour', 'unsalted butter', 'large egg'"),
    prep: z.string().describe("e.g. 'softened', or empty"),
    category: z.enum(CATS),
  })),
  steps: z.array(z.string()),
  prepMinutes: z.number().describe("hands-on mixing and shaping time"),
  chillMinutes: z.number().describe("minimum chill or rest before baking; 0 if none"),
  bakeMinutes: z.number().describe("per sheet; upper end of any range"),
  ovenTempF: z.number().describe("Fahrenheit; convert from Celsius"),
  cookiesPerSheet: z.number().describe("from the spacing; 12 if not stated"),
  coolMinutes: z.number(),
  doughKeepsDays: z.number().describe("days the dough keeps refrigerated; 0 if it should be baked right away"),
  freezable: z.boolean().describe("dough or baked cookies freeze well"),
  makeAheadTip: z.string().describe("one short sentence"),
  decorating: z.string().describe("icing or decorating after baking; empty if none"),
  decorateMinutes: z.number().describe("0 if none"),
});

const INSTRUCTIONS = `Extract the cookie recipe in this source into structured data for a home baking planner.
- Write quantities as decimals and use the larger number of any range.
- Include sub-recipes such as icing, glaze or filling in the ingredient list.
- Name each ingredient the way it would appear on a shopping list, so the same ingredient from different recipes can be combined.
- If a time, temperature or yield is missing, estimate it for this style of cookie.
- If the source holds no recipe, set isRecipe to false and say why in problem.`;

let client;
const getClient = () => (client ??= new Anthropic());

export class ExtractError extends Error {
  constructor(message, status = 422) { super(message); this.status = status; }
}

/**
 * Read a recipe with Claude.
 * @param {{text?: string, images?: {media_type: string, data: string}[]}} source
 */
export async function extractRecipe({ text = "", images = [] }) {
  if (!process.env.ANTHROPIC_API_KEY) throw new ExtractError("The server has no ANTHROPIC_API_KEY, so it can't read recipes yet.", 503);
  const content = [
    ...images.map((img) => ({ type: "image", source: { type: "base64", media_type: img.media_type, data: img.data } })),
    {
      type: "text",
      text: images.length
        ? `${INSTRUCTIONS}\n\nThe recipe is in the ${images.length > 1 ? `${images.length} attached photos, in page order` : "attached photo"}. Read every ingredient carefully, including handwritten notes.${text ? `\n\nNote from the baker: ${text}` : ""}`
        : `${INSTRUCTIONS}\n\n<source>\n${text}\n</source>`,
    },
  ];

  let response;
  try {
    response = await getClient().beta.messages.parse({
      model: process.env.CLAUDE_MODEL || "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "medium", format: betaZodOutputFormat(Recipe) },
      messages: [{ role: "user", content }],
    });
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) throw new ExtractError("The server's Anthropic API key was rejected.", 503);
    if (err instanceof Anthropic.RateLimitError) throw new ExtractError("Claude is busy right now. Try again in a minute.", 429);
    if (err instanceof Anthropic.BadRequestError) throw new ExtractError(`Claude couldn't take that input: ${err.message}`, 400);
    if (err instanceof Anthropic.APIError) throw new ExtractError("Claude had a problem reading the recipe. Try again.", 502);
    throw err;
  }

  if (response.stop_reason === "refusal") throw new ExtractError("Claude declined to read this source.");
  if (response.stop_reason === "max_tokens") throw new ExtractError("That recipe was too long to read in one go.");
  const out = response.parsed_output;
  if (!out) throw new ExtractError("Claude's answer couldn't be read. Try again.", 502);
  if (!out.isRecipe || !out.ingredients.length) throw new ExtractError(out.problem || "No recipe found there.");
  const { isRecipe, problem, ...recipe } = out;
  return recipe;
}
