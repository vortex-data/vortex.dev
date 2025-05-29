import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function GET() {
  try {
    const filePath = path.join(process.cwd(), 'src/assets/charter.pdf');
    
    // Check if file exists
    if (!fs.existsSync(filePath)) {
      console.error('Charter PDF not found at:', filePath);
      return NextResponse.json({ error: 'File not found' }, { status: 404 });
    }
    
    const fileBuffer = fs.readFileSync(filePath);
    
    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'inline; filename="charter.pdf"',
        'Cache-Control': 'public, max-age=31536000, immutable'
      }
    });
  } catch (error) {
    console.error('Error serving charter PDF:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}