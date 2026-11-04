import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

export async function GET() {
  try {
    const filePath = path.join(process.cwd(), "src/assets/charter.pdf");

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      console.error("Charter PDF not found at:", filePath);
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }

    const fileBuffer = fs.readFileSync(filePath);

    return new NextResponse(fileBuffer, {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": 'inline; filename="charter.pdf"',
        // The URL has no version, so an amended charter must reach readers
        // within a day.
        "Cache-Control": "public, max-age=86400"
      }
    });
  } catch (error) {
    console.error("Error serving charter PDF:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
