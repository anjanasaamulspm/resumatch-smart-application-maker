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

    // Dify workflow defines Current_Resume as a File input.
    // Upload the resume text as a .txt file and pass its id by reference.
    const form = new FormData();
    const resumeBlob = new Blob([data.currentResume], { type: "text/plain" });
    form.append("file", resumeBlob, "resume.txt");
    form.append("user", user);

    const uploadRes = await fetch(uploadUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });

    if (!uploadRes.ok) {
      const text = await uploadRes.text();
      throw new Error(`Dify upload error ${uploadRes.status}: ${text.slice(0, 300)}`);
    }

    const uploadJson = (await uploadRes.json()) as { id?: string };
    const uploadFileId = uploadJson?.id;
    if (!uploadFileId) throw new Error("Dify upload did not return a file id");

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
