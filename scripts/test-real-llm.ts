/**
 * Standalone Live Real-LLM Execution Script
 *
 * Runs the 4 production scenarios directly against OpenAI or Anthropic API:
 * 1. "yes" after call offer
 * 2. "both" (Lead Pilot + MAA)
 * 3. Question not in KB (expect handoff / lack of info)
 * 4. Slot pick ("10:00 AM IST")
 *
 * Usage:
 *   $env:OPENAI_API_KEY="sk-..."
 *   npx tsx scripts/test-real-llm.ts
 *
 * Or:
 *   $env:ANTHROPIC_API_KEY="sk-ant-..."
 *   npx tsx scripts/test-real-llm.ts
 */

import { generateReply } from '../src/lib/ai/generate';
import { buildSystemPrompt, HANDOFF_SENTINEL } from '../src/lib/ai/defaults';
import type { AiConfig } from '../src/lib/ai/types';

async function main() {
  const apiKey = process.env.OPENAI_API_KEY || process.env.ANTHROPIC_API_KEY;
  const isAnthropic = Boolean(process.env.ANTHROPIC_API_KEY);

  if (!apiKey) {
    console.error('================================================================');
    console.error('ERROR: No live API key found in process.env!');
    console.error('Please export your OpenAI or Anthropic API key before running:');
    console.error('  Windows PowerShell:');
    console.error('    $env:OPENAI_API_KEY="sk-proj-..."');
    console.error('    npx tsx scripts/test-real-llm.ts');
    console.error('  macOS / Linux:');
    console.error('    export OPENAI_API_KEY="sk-proj-..."');
    console.error('    npx tsx scripts/test-real-llm.ts');
    console.error('================================================================');
    process.exit(1);
  }

  const provider = isAnthropic ? 'anthropic' : 'openai';
  const model = isAnthropic ? 'claude-haiku-4-5-20251001' : 'gpt-4o-mini';

  console.log(`\n================================================================`);
  console.log(`Executing Live LLM Integration Tests`);
  console.log(`Provider: ${provider.toUpperCase()}`);
  console.log(`Model:    ${model}`);
  console.log(`================================================================\n`);

  const config: AiConfig = {
    provider,
    model,
    apiKey,
    systemPrompt: null,
    isActive: true,
    autoReplyEnabled: true,
    autoReplyMaxPerConversation: 10,
    handoffAgentId: null,
    embeddingsApiKey: null,
  };

  const sampleTenantKb = [
    'Geniplus Academy offers Abacus Mental Math classes for children aged 5-14. Free demo sessions last 45 minutes.',
    'Lead Pilot is an automated WhatsApp CRM and follow-up engine for education institutes. Demos last 30 minutes.',
    'Master Abacus Academy (MAA) is a franchise model for educators to start their own Abacus centre.',
    'Working hours and demo schedules: Monday through Saturday from 10:00 AM to 6:00 PM IST.',
  ];

  // Scenario 1: "yes" after call offer
  console.log('----------------------------------------------------------------');
  console.log('SCENARIO 1: Short reply "yes" after call offer');
  console.log('----------------------------------------------------------------');
  {
    const prompt = buildSystemPrompt({
      userPrompt: 'You are the assistant for Geniplus. Assist the user with their course inquiries.',
      mode: 'auto_reply',
      knowledge: sampleTenantKb,
    });
    const messages = [
      { role: 'user' as const, content: 'Do you offer abacus classes for kids?' },
      { role: 'assistant' as const, content: 'Yes! We offer Abacus Mental Math for kids aged 5 to 14. Would you like to schedule a quick demo session?' },
      { role: 'user' as const, content: 'yes' },
    ];
    const reply = await generateReply({ config, systemPrompt: prompt, messages });
    console.log('Input Transcript:');
    console.log('  User: Do you offer abacus classes for kids?');
    console.log('  Assistant: Would you like to schedule a quick demo session?');
    console.log('  User: yes');
    console.log('\nActual Model Reply:');
    console.log(reply.text);
    console.log(`Usage: Prompt=${reply.usage?.promptTokens}, Completion=${reply.usage?.completionTokens}, Handoff=${reply.handoff}\n`);
  }

  // Scenario 2: "both" (Lead Pilot + MAA)
  console.log('----------------------------------------------------------------');
  console.log('SCENARIO 2: "both" (User interested in two candidate services)');
  console.log('----------------------------------------------------------------');
  {
    const prompt = buildSystemPrompt({
      userPrompt: 'You are the assistant for Geniplus. We provide both Lead Pilot software and MAA teacher franchise training.',
      mode: 'auto_reply',
      knowledge: sampleTenantKb,
    });
    const messages = [
      { role: 'user' as const, content: 'Tell me about Lead Pilot and MAA' },
      { role: 'assistant' as const, content: 'Lead Pilot is our WhatsApp CRM for institutes, while MAA is our Abacus franchise & training program. Which would you prefer to explore first?' },
      { role: 'user' as const, content: 'both' },
    ];
    const reply = await generateReply({ config, systemPrompt: prompt, messages });
    console.log('Input Transcript:');
    console.log('  User: Tell me about Lead Pilot and MAA');
    console.log('  Assistant: Which would you prefer to explore first?');
    console.log('  User: both');
    console.log('\nActual Model Reply:');
    console.log(reply.text);
    console.log(`Usage: Prompt=${reply.usage?.promptTokens}, Completion=${reply.usage?.completionTokens}, Handoff=${reply.handoff}\n`);
  }

  // Scenario 3: Question not in KB (expect handoff)
  console.log('----------------------------------------------------------------');
  console.log('SCENARIO 3: Question not in KB (admits missing info & hands off)');
  console.log('----------------------------------------------------------------');
  {
    const prompt = buildSystemPrompt({
      userPrompt: 'You are the assistant for Geniplus. Ground your answers strictly in the knowledge base.',
      mode: 'auto_reply',
      knowledge: sampleTenantKb,
    });
    const messages = [
      { role: 'user' as const, content: 'Do you offer ISO 9001 certified accounting audit services?' },
    ];
    const reply = await generateReply({ config, systemPrompt: prompt, messages });
    console.log('Input Transcript:');
    console.log('  User: Do you offer ISO 9001 certified accounting audit services?');
    console.log('\nActual Model Reply:');
    console.log(reply.text);
    console.log(`Handoff Detected: ${reply.handoff || reply.text.includes(HANDOFF_SENTINEL)}`);
    console.log(`Usage: Prompt=${reply.usage?.promptTokens}, Completion=${reply.usage?.completionTokens}\n`);
  }

  // Scenario 4: Slot pick ("10:00 AM IST")
  console.log('----------------------------------------------------------------');
  console.log('SCENARIO 4: Slot pick ("10:00 AM IST" from offered slots)');
  console.log('----------------------------------------------------------------');
  {
    const slotContext = '\n\n[AVAILABLE APPOINTMENT SLOTS FROM CALENDAR]:\n• Tomorrow, Wednesday at 10:00 AM IST\n• Tomorrow, Wednesday at 2:00 PM IST\n• Tomorrow, Wednesday at 4:30 PM IST';
    const prompt = buildSystemPrompt({
      userPrompt: 'You are the assistant for Geniplus. Assist the user with booking a demo session.' + slotContext,
      mode: 'auto_reply',
      knowledge: sampleTenantKb,
    });
    const messages = [
      { role: 'user' as const, content: 'When can we book the demo?' },
      { role: 'assistant' as const, content: 'We have slots open tomorrow at 10:00 AM IST, 2:00 PM IST, and 4:30 PM IST. Which time works best for you?' },
      { role: 'user' as const, content: '10:00 AM IST works for me' },
    ];
    const reply = await generateReply({ config, systemPrompt: prompt, messages });
    console.log('Input Transcript:');
    console.log('  User: When can we book the demo?');
    console.log('  Assistant: We have slots open tomorrow at 10:00 AM IST, 2:00 PM IST, and 4:30 PM IST...');
    console.log('  User: 10:00 AM IST works for me');
    console.log('\nActual Model Reply:');
    console.log(reply.text);
    console.log(`Usage: Prompt=${reply.usage?.promptTokens}, Completion=${reply.usage?.completionTokens}, Handoff=${reply.handoff}\n`);
  }

  console.log('================================================================');
  console.log('Live LLM Integration Test Run Complete!');
  console.log('================================================================');
}

main().catch((err) => {
  console.error('Fatal error during Live LLM execution:', err);
  process.exit(1);
});
