import { generateObject } from 'ai';
import { google } from '@ai-sdk/google';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const allMaterials = await prisma.materialMaster.findMany();
  const catalogContext = allMaterials.map(m => `${m.materialCode}: ${m.description}`).join('\n');

  const allSourceLists = await prisma.sourceList.findMany({
    select: { plant: true, plantDescription: true },
    distinct: ['plant']
  });
  const plantContext = allSourceLists.map(p => `${p.plant}: ${p.plantDescription}`).join('\n');

  const prompt = "I want to buy capacitor in NY plant. I want it within 7 days - who is my best supplier";

  const { object } = await generateObject({
    model: google('gemini-2.5-flash'),
    schema: z.object({
      materialCode: z.string().describe("The exact materialCode from the catalog that best matches the request, or empty string if no reasonable match can be made."),
      plantCode: z.string().describe("The exact plant code from the plant list that best matches the request, or empty string if no reasonable match can be made or none specified."),
      userIntent: z.string().describe("A summary of the user's specific requirement or question, e.g., 'Needs delivery in 7 days' or 'Wants the cheapest option'.")
    }),
    prompt: `Extract the requested material, plant, and user intent from this user request: "${prompt}".
Here is the catalog of available materials:
${catalogContext}

Here is the list of available plants:
${plantContext}

Find the materialCode from the catalog that best matches the user's requested material (e.g., if they ask for "capacitor" or "50 capacitor", use the code for "50V Ceramic Capacitor"). Be highly forgiving with typos or shorthand. Only return an empty string if it's completely ambiguous or unrelated to anything in the catalog.
Similarly, find the plantCode from the plant list that best matches the user's requested plant (e.g. "Dallas" matches P-10). If they did not specify a plant, return an empty string.`
  });

  console.log("Fuzzy Match Results:");
  console.log(object);
}

main().catch(console.error);
