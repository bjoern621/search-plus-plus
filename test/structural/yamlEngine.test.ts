import { describe, expect, it } from "vitest";
import { parseQuery } from "../../src/query";
import { yamlEngine } from "../../src/structural";
import { fixture, found, highlighted, search } from "./search";

const values = fixture("values.yaml");

function inValues(query: string): string[] {
  return found(search(yamlEngine, "charts/apim/values.yaml", "yaml", values, query));
}

describe("yamlEngine: examples from DESIGN.md", () => {
  it("finds enabled under gravitee under values under global, with its close spellings, and nowhere else", () => {
    expect(inValues("global.values.gravitee.enabled")).toEqual([
      "5: global.values.gravitee.enabled",
      "6: global.values.gravitee.enable",
      "7: global.values.gravitee.Enabled",
    ]);
  });

  it("finds global.values.gravitee.enabled through Global.Values.Gravite.Enabled", () => {
    const matches = search(yamlEngine, "values.yaml", "yaml", values, "Global.Values.Gravite.Enabled");
    expect(found(matches)[0]).toBe("5: global.values.gravitee.enabled");
    expect(matches[0]!.reasons).toContainEqual({ kind: "fuzzy", query: "Gravite", found: "gravitee", edits: 1 });
    expect(matches[0]!.reasons).toContainEqual({ kind: "case", query: "Global", found: "global" });
  });

  it("matches one key with *", () => {
    expect(inValues("values.*.enabled")).toEqual(["10: values.gateway.enabled", "12: values.portal.enabled", "14: values.ui.enabled"]);
  });

  it("matches the rest of a key with a trailing *", () => {
    expect(inValues("global.values.grav*.enabled")).toContain("5: global.values.gravitee.enabled");
  });

  it("leaves out the other keys with a group", () => {
    expect(inValues("values.{gateway,portal}.enabled")).toEqual(["10: values.gateway.enabled", "12: values.portal.enabled"]);
  });

  it("finds a sequence item by its index", () => {
    expect(inValues("ingress.hosts.0")).toEqual(["27: ingress.hosts.0"]);
  });

  it("finds a key holding dots through quotes or escapes", () => {
    expect(inValues('metadata.labels."app.kubernetes.io/name"')).toEqual(["31: metadata.labels.app.kubernetes.io/name"]);
    expect(inValues("metadata.labels.app\\.kubernetes\\.io/name")).toEqual(["31: metadata.labels.app.kubernetes.io/name"]);
  });

  it("finds both memory settings with **.{requests,limits}.memory", () => {
    expect(inValues("**.{requests,limits}.memory")).toEqual(["22: gateway.resources.requests.memory", "24: gateway.resources.limits.memory"]);
  });

  it("leaves out enable and Enabled with **.\"enabled\"", () => {
    const lines = inValues('**."enabled"');
    expect(lines).toContain("5: global.values.gravitee.enabled");
    expect(lines).not.toContain("6: global.values.gravitee.enable");
    expect(lines).not.toContain("7: global.values.gravitee.Enabled");
  });

  it("finds the image tag at any depth with **.image.tag", () => {
    expect(inValues("**.image.tag")).toEqual(["18: gateway.image.tag"]);
  });

  it("matches umlauts and their spelled-out form", () => {
    expect(inValues("metadata.labels.groesse")).toEqual(["32: metadata.labels.größe"]);
  });
});

describe("yamlEngine: ranges", () => {
  it("highlights the key of a pair, quotes included", () => {
    const matches = search(yamlEngine, "values.yaml", "yaml", values, 'metadata.labels."app.kubernetes.io/name"');
    expect(highlighted(values, matches)).toEqual(['"app.kubernetes.io/name"']);
  });

  it("highlights a sequence item on its first line", () => {
    const matches = search(yamlEngine, "values.yaml", "yaml", values, "ingress.hosts.1");
    expect(highlighted(values, matches)).toEqual(["portal.example.com"]);
  });
});

describe("yamlEngine: documents, anchors and templates", () => {
  it("starts a key path in each document of a multi-document file", () => {
    const text = fixture("multi.yaml");
    expect(found(search(yamlEngine, "k8s/web.yml", "yaml", text, "metadata.name"))).toEqual(["4: metadata.name", "9: metadata.name"]);
    expect(found(search(yamlEngine, "k8s/web.yml", "yaml", text, "**.containers.0.image"))).toEqual([
      "15: spec.template.spec.containers.0.image",
    ]);
  });

  it("finds the keys of an anchor through an alias, at the lines of the anchor", () => {
    const text = fixture("anchors.yaml");
    expect(found(search(yamlEngine, "anchors.yaml", "yaml", text, "staging.settings.image.tag"))).toEqual([
      "4: staging.settings.image.tag",
    ]);
  });

  it("merges the keys of a merge key, keeping the keys of the merging map", () => {
    const text = fixture("anchors.yaml");
    expect(found(search(yamlEngine, "anchors.yaml", "yaml", text, "prod.image.tag"))).toEqual(["4: prod.image.tag"]);
    expect(found(search(yamlEngine, "anchors.yaml", "yaml", text, "prod.replicas"))).toEqual(["7: prod.replicas"]);
  });

  it("shows a node met through an alias once, under its own key path", () => {
    const text = fixture("anchors.yaml");
    expect(found(search(yamlEngine, "anchors.yaml", "yaml", text, "**.tag"))).toEqual(["4: defaults.image.tag"]);
  });

  it("stops an alias that refers to its own anchor", () => {
    const text = "a: &a\n  b: *a\n  c: 1\n";
    expect(found(search(yamlEngine, "loop.yaml", "yaml", text, "**.c"))).toEqual(["3: a.c"]);
  });

  it("reads a Helm template around its actions", () => {
    const text = fixture("deployment.yaml");
    const matches = search(yamlEngine, "templates/deployment.yaml", "helm", text, "spec.template.spec.containers.0.image");
    expect(found(matches)).toEqual(["13: spec.template.spec.containers.0.image"]);
    expect(found(search(yamlEngine, "templates/deployment.yaml", "helm", text, "metadata.labels"))).toEqual(["6: metadata.labels"]);
  });

  it("keeps the readable keys of a broken file and throws nothing", () => {
    const text = "a: [1, 2\nb:\n  c: 1\n";
    expect(() => search(yamlEngine, "broken.yaml", "yaml", text, "**.c")).not.toThrow();
    expect(found(search(yamlEngine, "broken.yaml", "yaml", "a:\n  b: 1\n   c: 2\nd:\n  e: 3\n", "d.e"))).toEqual(["5: d.e"]);
  });
});

describe("yamlEngine.accepts", () => {
  const file = (relativePath: string, languageId: string) => ({ uri: `file:///${relativePath}`, relativePath, languageId });

  it("accepts YAML files by language or extension", () => {
    const query = parseQuery("a.b");
    expect(yamlEngine.accepts(file("values.yaml", "yaml"), query)).toBe(true);
    expect(yamlEngine.accepts(file("templates/x.yaml", "helm"), query)).toBe(true);
    expect(yamlEngine.accepts(file("ci.YML", "plaintext"), query)).toBe(true);
    expect(yamlEngine.accepts(file("main.ts", "typescript"), query)).toBe(false);
  });

  it("declines a regex and a query that breaks the key path grammar", () => {
    expect(yamlEngine.accepts(file("values.yaml", "yaml"), parseQuery("/a.b/"))).toBe(false);
    expect(yamlEngine.accepts(file("values.yaml", "yaml"), parseQuery("a[b"))).toBe(false);
    expect(yamlEngine.accepts(file("values.yaml", "yaml"), parseQuery(".Values.global"))).toBe(false);
  });
});
