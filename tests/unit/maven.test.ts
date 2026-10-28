import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { getSparkVersion } from "@/lib/maven";

// A stand-in for fetch that records its call and answers with `respond`.
function stub(respond: () => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fake = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return respond();
  }) as typeof fetch;
  return { fake, calls };
}

const xml = (body: string, status = 200) =>
  new Response(body, {
    status,
    headers: { "Content-Type": "text/xml" }
  });

// The shape of Maven Central's metadata for the artifact, cut down.
const METADATA = `<?xml version="1.0" encoding="UTF-8"?>
<metadata>
  <groupId>dev.vortex</groupId>
  <artifactId>vortex-spark_2.13</artifactId>
  <versioning>
    <latest>0.90.0</latest>
    <release>0.90.0</release>
    <versions>
      <version>0.89.0</version>
      <version>0.90.0</version>
    </versions>
  </versioning>
</metadata>`;

describe("getSparkVersion", () => {
  it("reads the latest release of vortex-spark_2.13 from Maven Central, cached for a day", async () => {
    const { fake, calls } = stub(() => xml(METADATA));
    assert.equal(await getSparkVersion(fake), "0.90.0");
    assert.equal(calls.length, 1);
    const call = calls[0];
    assert.equal(
      call?.url,
      "https://repo1.maven.org/maven2/dev/vortex/vortex-spark_2.13/maven-metadata.xml"
    );
    const init = call?.init as RequestInit & { next?: { revalidate?: number } };
    assert.equal(init.next?.revalidate, 86400);
    assert.ok(init.signal instanceof AbortSignal, "the request has a timeout");
  });

  it("gives null when Maven Central answers with an error", async () => {
    const { fake } = stub(() => xml("Not Found", 404));
    assert.equal(await getSparkVersion(fake), null);
  });

  it("gives null when the request fails", async () => {
    const { fake } = stub(() => {
      throw new TypeError("fetch failed");
    });
    assert.equal(await getSparkVersion(fake), null);
  });

  it("gives null when the metadata has no usable release", async () => {
    for (const body of [
      "",
      "<metadata></metadata>",
      "<metadata><versioning><latest>0.90.0</latest></versioning></metadata>",
      "<metadata><release></release></metadata>",
      "<metadata><release>0.90.0-SNAPSHOT</release></metadata>",
      '<metadata><release>0.90.0:all")</release></metadata>',
      "<html>"
    ]) {
      const { fake } = stub(() => xml(body));
      assert.equal(await getSparkVersion(fake), null, body);
    }
  });
});
