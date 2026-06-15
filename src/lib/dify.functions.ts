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

    const res = await fetch("https://api.dify.ai/v1/workflows/run", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        inputs: {
          Target_Role: data.targetRole,
          Current_Resume: data.currentResume,
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
