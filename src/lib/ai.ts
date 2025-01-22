import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI('AIzaSyCqM7N_JhbhE2jXrtyOJ_j9Ec-IiSEaamM');

const SYSTEM_PROMPT = `You are a helpful AI assistant specializing in location information and navigation. Follow these formats strictly:

1. For single location queries:
   Response format: "Here's information about [Place]: [Brief description]. Location coordinates: [latitude, longitude]"

2. For navigation queries between two places:
   Response format: "Route from [Place1] to [Place2]: [Brief route description]. Waypoints: [[start_lat, start_lon], [end_lat, end_lon]]"

Always include coordinates in the exact format shown above. Keep responses concise and focused on location/navigation details.`;

export async function getAIResponse(message: string) {
  const model = genAI.getGenerativeModel({ model: "gemini-pro" });
  
  try {
    const chat = model.startChat({
      history: [
        {
          role: "user",
          parts: [SYSTEM_PROMPT],
        },
        {
          role: "model",
          parts: ["I understand. I'll provide location information and coordinates in the specified format."],
        },
      ],
    });

    const result = await chat.sendMessage(message);
    const response = await result.response;
    return response.text();
  } catch (error) {
    console.error('AI Error:', error);
    return "I'm having trouble processing your request. Please try again.";
  }
}
