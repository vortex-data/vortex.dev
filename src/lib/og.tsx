import { ImageResponse } from "next/og";
import { siteName } from "@/lib/constants";

export const OG_SIZE = { width: 1200, height: 630 } as const;
export const OG_CONTENT_TYPE = "image/png";

export function renderOgImage(props: {
  title: string;
  description?: string;
  eyebrow?: string;
}) {
  return new ImageResponse(
    <OgCard
      title={props.title}
      description={props.description}
      eyebrow={props.eyebrow}
    />,
    OG_SIZE
  );
}

function OgCard({
  title,
  description,
  eyebrow
}: {
  title: string;
  description?: string;
  eyebrow?: string;
}) {
  return (
    <div
      style={{
        height: "100%",
        width: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: "80px",
        backgroundColor: "#0a0a0a",
        color: "#ffffff",
        fontFamily: "sans-serif"
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "16px",
          fontSize: 28,
          letterSpacing: "0.18em",
          textTransform: "uppercase",
          color: "rgba(255,255,255,0.7)",
          fontFamily: "monospace"
        }}
      >
        <span>{siteName}</span>
        {eyebrow ? (
          <>
            <span style={{ color: "rgba(255,255,255,0.3)" }}>/</span>
            <span>{eyebrow}</span>
          </>
        ) : null}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "28px" }}>
        <div
          style={{
            fontSize: 76,
            fontWeight: 300,
            lineHeight: 1.08,
            letterSpacing: "-0.02em",
            color: "#ffffff"
          }}
        >
          {title}
        </div>
        {description ? (
          <div
            style={{
              fontSize: 32,
              lineHeight: 1.35,
              color: "rgba(255,255,255,0.7)"
            }}
          >
            {description}
          </div>
        ) : null}
      </div>
    </div>
  );
}
