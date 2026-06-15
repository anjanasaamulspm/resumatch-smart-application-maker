import { createServerFn } from "@tanstack/react-start";

type Input = {
  targetRole: string;
  currentResume: string;
  jobDescription: string;
};

export const generateApplication = createServerFn({ method: "POST" })
  .inputValidator((data: Input) => {
    if (!data?.targetRole || !data?.currentResume || !data?.jobDescription) {
      throw new Error("Missing required fields");
    }
    return data;
  })
  .handler(async ({ data }) => {
    const apiKey = process.env.DIFY_API_KEY;
    if (!apiKey) throw new Error("DIFY_API_KEY is not configured");

    const apiUrl = process.env.DIFY_API_URL || "https://api.dify.ai/v1/workflows/run";

    // Parse the file data cleanly if it's sent as a string json metadata block, 
    // or pass it along natively if it's already an object.
    let filePayload;
    try {
      filePayload = typeof data.currentResume === 'string' && data.currentResume.startsWith('{') 
        ? JSON.parse(data.currentResume) 
        : data.currentResume;
    } catch (e) {
      filePayload = data.currentResume;
    }

    const res = await fetch(apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inputs: {
          Target_Role: data.targetRole,
          // Fixed: Wrapped the file filePayload into an array structure []
          Current_Resume: Array.isArray(filePayload) ? filePayload : [filePayload],
          Job_description: data.jobDescription,
        },
        response_mode: "blocking",
        user: "portfolio-user-1",
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Dify API error ${res.status}: ${text.slice(0, 300)}`);
    }

    const json = (await res.json()) as {
      data?: { outputs?: { tailored_resume?: string; cover_letter?: string } };
    };

    const outputs = json?.data?.outputs ?? {};
    return {
      tailored_resume: outputs.tailored_resume ?? "",
      cover_letter: outputs.cover_letter ?? "",
    };
  });
