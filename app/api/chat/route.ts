import { generateText, generateObject } from 'ai';
import { google } from '@ai-sdk/google';
import { z } from 'zod';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function POST(request: Request) {
  try {
    const { query } = await request.json();

    if (!query || typeof query !== 'string') {
      return new Response(JSON.stringify({ error: 'Query is required' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // 1. Fuzzy Match - Extract material, plant, and intent
    const allMaterials = await prisma.materialMaster.findMany();
    const catalogContext = allMaterials.map((m: any) => `${m.materialCode}: ${m.description}`).join('\n');

    const allSourceLists = await prisma.sourceList.findMany({
      select: { plant: true, plantDescription: true },
      distinct: ['plant']
    });
    const plantContext = allSourceLists.map((p: any) => `${p.plant}: ${p.plantDescription}`).join('\n');

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

    if (!object.materialCode) {
      return new Response(
        JSON.stringify({ 
          response: "I couldn't identify the material you're looking for. Please try specifying the material name more clearly." 
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // 2. Query DB for sources
    const whereClause: any = { materialCode: object.materialCode };
    if (object.plantCode) whereClause.plant = object.plantCode;

    const sources = await prisma.sourceList.findMany({ where: whereClause });
    if (sources.length === 0) {
      return new Response(
        JSON.stringify({ 
          response: `No suppliers found for ${object.materialCode}${object.plantCode ? ` in plant ${object.plantCode}` : ''}. Please try a different material or plant.` 
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }

    // 3. Gather supplier data
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
        const sum = pos.reduce((acc: number, p: any) => acc + p.procurementPrice, 0);
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

    // 4. Generate Recommendation
    const briefInstructions = '- Keep the response extremely concise. Just state the recommended supplier, the key metric (like price), their Planned Delivery Time (PDT), and 1 sentence on why.';
    const detailedInstructions = '- Provide a thorough analysis based on the user intent. Explain why the supplier was chosen, compare them to others if relevant, and list standard prices and delivery times.';

    const recommendationPrompt = `
    User's Intent/Requirement: "${object.userIntent}"
    Supplier Data: ${JSON.stringify(supplierDataContext)}
    Instructions:
    - The user has requested a **${isBrief ? 'BRIEF SUMMARY' : 'DETAILED INFO'}**.
    ${isBrief ? briefInstructions : detailedInstructions}
    - Act intelligently based on the User's Intent.
    `;

    const { text } = await generateText({
      model: google('gemini-2.5-flash'),
      prompt: recommendationPrompt,
    });

    return new Response(
      JSON.stringify({ response: text.trim() }),
      {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  } catch (error: any) {
    console.error('Chat API error:', error);
    return new Response(
      JSON.stringify({ error: error.message || 'An error occurred' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }
    );
  }
}
