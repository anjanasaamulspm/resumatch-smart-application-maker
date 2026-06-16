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

    const baseUrl = process.env.DIFY_API_BASE_URL || "https://api.dify.ai/v1";
    const runUrl = process.env.DIFY_API_URL || `${baseUrl}/workflows/run`;
    const uploadUrl = `${baseUrl}/files/upload`;
    const user = "portfolio-user-1";

    // ⏱️ 1. Set up the 60-second Abort Controller timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 1 minute limit

    try {
      // Dify workflow defines Current_Resume as a File input.
      // Upload the resume text as a .txt file and pass its id by reference.
      const form = new FormData();
      const resumeBlob = new Blob([data.currentResume], { type: "text/plain" });
      form.append("file", resumeBlob, "resume.txt");
      form.append("user", user);

      // Pass the signal to the upload request
      const uploadRes = await fetch(uploadUrl, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
        signal: controller.signal,
      });

      if (!uploadRes.ok) {
        const text = await uploadRes.text();
        throw new Error(`Dify upload error ${uploadRes.status}: ${text.slice(0, 300)}`);
      }

      const uploadJson = (await uploadRes.json()) as { id?: string };
      const uploadFileId = uploadJson?.id;
      if (!uploadFileId) throw new Error("Dify upload did not return a file id");

      // 2. Fire the primary workflow execution
      const res = await fetch(runUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          inputs: {
            Target_Role: data.targetRole,
            Current_Resume: [
              {
                type: "document",
                transfer_method: "local_file",
                upload_file_id: uploadFileId,
              },
            ],
            Job_description: data.jobDescription,
          },
          response_mode: "blocking",
          user,
        }),
        signal: controller.signal, // Pass the signal to the workflow execution
      });

      // Clear the timeout safely since it completed before 60 seconds
      clearTimeout(timeoutId);

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Dify API error ${res.status}: ${text.slice(0, 300)}`);
      }

      const json = (await res.json()) as any;

      // 🌟 3. Resilient Gemini JSON Parser to resolve blank screens
      let tailored_resume = "";
      let cover_letter = "";

      if (json?.data?.outputs) {
        tailored_resume = json.data.outputs.tailored_resume ?? "";
        cover_letter = json.data.outputs.cover_letter ?? "";
      } else if (json?.outputs) {
        tailored_resume = json.outputs.tailored_resume ?? "";
        cover_letter = json.outputs.cover_letter ?? "";
      } else if (json?.tailored_resume) {
        tailored_resume = json.tailored_resume;
        cover_letter = json.cover_letter ?? "";
      } else if (json?.text) {
        try {
          const parsedText = JSON.parse(json.text);
          tailored_resume = parsedText.tailored_resume ?? json.text;
          cover_letter = parsedText.cover_letter ?? "";
        } catch (e) {
          tailored_resume = json.text;
        }
      }

      return {
        tailored_resume: tailored_resume ?? "",
        cover_letter: cover_letter ?? "",
        status: "success"
      };

    } catch (error: any) {
      // Ensure the tracking timer is wiped on errors
      clearTimeout(timeoutId);

      // Intercept the Abort signal and return your exact busy message text
      if (error.name === 'AbortError') {
        throw new Error("TIMEOUT_ERROR: The engine is currently busy or experiencing high traffic. Please check your dashboard or try again in a moment.");
      }
      throw error;
    }
  });
