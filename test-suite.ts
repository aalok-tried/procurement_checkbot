import { generateText, generateObject } from 'ai';
import { google } from '@ai-sdk/google';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';
import dotenv from 'dotenv';
dotenv.config();

const prisma = new PrismaClient();

const testQueries = [
  "I want to buy capacitor in NY plant. I want it within 7 days - who is my best supplier",
  "Blue LED for Austin plant. Cheapest option.",
  "Get me the cheapest lithium battery across any plant",
  "Need a DC motor for Miami quickly",
  "Best supplier for nylon washers in Seattle",
  "I need a resistor 10k ohm in Chicago. I want detailed analysis.",
  "Give me a brief summary of the best supplier for microcontrollers in Austin."
];

async function runTest() {
  console.log("=== STARTING PROCUREMENT TEST SUITE ===\n");
  
  const allMaterials = await prisma.materialMaster.findMany();
  const catalogContext = allMaterials.map((m: any) => `${m.materialCode}: ${m.description}`).join('\n');

  const allSourceLists = await prisma.sourceList.findMany({
    select: { plant: true, plantDescription: true },
    distinct: ['plant']
  });
  const plantContext = allSourceLists.map((p: any) => `${p.plant}: ${p.plantDescription}`).join('\n');

  for (const query of testQueries) {
    console.log(`\n--------------------------------------------------`);
    console.log(`Testing Query: "${query}"`);
    console.log(`--------------------------------------------------`);
    
    try {
      // 1. Fuzzy Match
      const { object } = await generateObject({
        model: google('gemini-2.5-flash'),
        schema: z.object({
          materialCode: z.string(),
          plantCode: z.string(),
          userIntent: z.string()
        }),
        prompt: `Extract the requested material, plant, and user intent from this user request: "${query}".
          Here is the catalog of available materials:\n${catalogContext}\n
          Here is the list of available plants:\n${plantContext}\n
          Find the materialCode from the catalog that best matches the user's requested material.
          Similarly, find the plantCode from the plant list that best matches the user's requested plant. If they did not specify a plant, return an empty string.`
      });

      console.log(`[Extracted] Material: ${object.materialCode || 'ANY'}, Plant: ${object.plantCode || 'ANY'}`);
      console.log(`[Intent] ${object.userIntent}`);

      if (!object.materialCode) {
        console.log("-> No sources found (Material missing)");
        continue;
      }

      // 2. Query DB
      const whereClause: any = { materialCode: object.materialCode };
      if (object.plantCode) whereClause.plant = object.plantCode;
      
      const sources = await prisma.sourceList.findMany({ where: whereClause });
      if (sources.length === 0) {
        console.log("-> No sources found in DB");
        continue;
      }
      
      const supplierDataContext = [];
      for (const source of sources) {
        const pir = await prisma.purchaseInfoRecord.findFirst({
          where: { materialCode: source.materialCode, vendorCode: source.supplierCode, plant: source.plant },
          orderBy: { standardPrice: 'asc' }
        });
        const pos = await prisma.historicalPO.findMany({
          where: { materialCode: source.materialCode, vendorCode: source.supplierCode, plant: source.plant },
          orderBy: { poDate: 'desc' }
        });
        
        let averagePoPrice = 0, latestPoPrice = 0;
        if (pos.length > 0) {
          const sum = pos.reduce((acc, p) => acc + p.procurementPrice, 0);
          averagePoPrice = sum / pos.length;
          latestPoPrice = pos[0].procurementPrice;
        }

        supplierDataContext.push({
          supplierCode: source.supplierCode,
          supplierDescription: source.supplierDescription,
          plant: source.plant,
          standardPrice: pir?.standardPrice,
          plannedDeliveryTime: pir?.plannedDeliveryTime,
          averagePoPrice,
          latestPoPrice,
        });
      }

      const isBrief = !query.toLowerCase().includes('detail');
      
      // 3. Generate Recommendation
      const recommendationPrompt = `
      User's Intent/Requirement: "${object.userIntent}"
      Supplier Data: ${JSON.stringify(supplierDataContext)}
      Instructions:
      - The user has requested a **${isBrief ? 'BRIEF SUMMARY' : 'DETAILED INFO'}**.
      ${isBrief 
        ? '- Keep the response extremely concise. Just state the recommended supplier, the key metric (like price), their Planned Delivery Time (PDT), and 1 sentence on why. Do not list exhaustiv[...]'
        : '- Provide a thorough analysis based on the user intent. Explain why the supplier was chosen, compare them to others if relevant, and list standard prices and delivery times.'}
      - Act intelligently based on the User's Intent.
      `;

      const { text } = await generateText({
        model: google('gemini-2.5-flash'),
        prompt: recommendationPrompt,
      });

      console.log(`[Response]\n${text.trim()}`);
    } catch (e: any) {
      console.log(`[Error] ${e.message}`);
    }
  }
}

runTest().catch(console.error).finally(() => prisma.$disconnect());
