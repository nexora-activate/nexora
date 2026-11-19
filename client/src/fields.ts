// Build-time macro: each action's request fields as form-input
// attributes, read from the Zod schemas the server enforces — so the
// page and the server can't disagree about a field's limits. Bun
// inlines the result while bundling the client, so the page carries no
// copy of any limit.
//
// Must be imported `with { type: "macro" }`; it reads the app's
// `server/src/actions.ts`, relative to the client build's working
// directory (the app root).
import { createRequire } from "node:module";
import { join } from "node:path";

interface ZodNode {
  _zod?: {
    def?: {
      type?: string;
      innerType?: ZodNode;
      shape?: Record<string, ZodNode>;
      element?: ZodNode;
    };
    bag?: {
      minimum?: number;
      maximum?: number;
      exclusiveMinimum?: number;
      exclusiveMaximum?: number;
      format?: string;
    };
  };
}

/** Attributes to spread onto the `<input>` or `<textarea>` that feeds one request field. */
export interface FieldProps {
  name: string;
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  step?: number | "any";
  type?: "email" | "url" | "number";
}

type Described = FieldProps | { [field: string]: Described };

const WRAPPERS = new Set([
  "optional",
  "nullable",
  "default",
  "prefault",
  "readonly",
  "catch",
]);
const INTEGER_FORMATS = new Set(["safeint", "int32", "uint32", "int64", "uint64"]);

/** The fields of a request schema, or `{}` when the request is not an object. */
function describeRequest(schema: unknown): Record<string, Described> {
  const node = schema as ZodNode;
  if (node?._zod?.def?.type !== "object") return {};
  return describe(node, "", new Set()) as Record<string, Described>;
}

function describe(
  start: ZodNode,
  name: string,
  active: Set<ZodNode>,
  parentOptional = false,
): Described {
  let node = start;
  let optional = parentOptional;
  while (
    node._zod?.def?.type !== undefined &&
    WRAPPERS.has(node._zod.def.type) &&
    node._zod.def.innerType !== undefined
  ) {
    if (node._zod.def.type !== "readonly" && node._zod.def.type !== "catch") {
      optional = true;
    }
    node = node._zod.def.innerType;
  }
  const def = node._zod?.def;
  if (!def) return { name };
  if (def.type === "object" && def.shape !== undefined) {
    if (active.has(node)) return {};
    active.add(node);
    const fields: Record<string, Described> = {};
    for (const [field, child] of Object.entries(def.shape)) {
      fields[field] = describe(child, field, active, optional);
    }
    active.delete(node);
    return fields;
  }
  if (def.type === "array" && def.element !== undefined) {
    return describe(def.element, name, active, true);
  }
  return scalar(node, name, optional);
}

function scalar(node: ZodNode, name: string, optional: boolean): FieldProps {
  const props: FieldProps = { name };
  const bag = node._zod?.bag ?? {};
  if (node._zod?.def?.type === "string") {
    if (bag.minimum !== undefined && bag.minimum > 0) {
      props.minLength = bag.minimum;
      if (!optional) props.required = true;
    }
    if (bag.maximum !== undefined) props.maxLength = bag.maximum;
    if (bag.format === "email" || bag.format === "url") {
      props.type = bag.format;
      if (!optional) props.required = true;
    }
    return props;
  }
  if (node._zod?.def?.type === "number") {
    const integer = bag.format !== undefined && INTEGER_FORMATS.has(bag.format);
    const step = integer ? 1 : 0;
    props.type = "number";
    props.step = integer ? 1 : "any";
    if (!optional) props.required = true;
    const min = tightest(Math.max, bag.minimum, bag.exclusiveMinimum, step);
    const max = tightest(Math.min, bag.maximum, bag.exclusiveMaximum, -step);
    if (min !== undefined) props.min = min;
    if (max !== undefined) props.max = max;
  }
  return props;
}

// `.int()` adds the safe-integer range as its own bound; it is not a
// limit a person could reach by typing, so it never becomes an attribute.
function tightest(
  pick: (a: number, b: number) => number,
  inclusive: number | undefined,
  exclusive: number | undefined,
  integerStep: number,
): number | undefined {
  const bounds = [
    inclusive,
    exclusive === undefined ? undefined : exclusive + integerStep,
  ].filter(
    (bound): bound is number =>
      bound !== undefined &&
      Number.isFinite(bound) &&
      Math.abs(bound) < Number.MAX_SAFE_INTEGER,
  );
  return bounds.length === 0 ? undefined : bounds.reduce(pick);
}

/**
 * One request schema's fields: an object field nests its own fields, a
 * list field takes the fields of one item, and every other field is the
 * attributes of its input.
 */
export type RequestFields<S> = S extends { shape: infer Shape }
  ? { readonly [F in keyof Shape]: RequestFields<Shape[F]> }
  : S extends { element: infer Item }
    ? RequestFields<Item>
    : S extends { unwrap(): infer Inner }
      ? RequestFields<Inner>
      : FieldProps;

type ActionRequestFields<A> = A extends { request: { shape: infer Shape } }
  ? { readonly [F in keyof Shape]: RequestFields<Shape[F]> }
  : Record<never, never>;

/**
 * Input attributes for each action's request fields, keyed by action
 * name and then field name.
 */
export type ActionFields<A> = {
  readonly [K in keyof A]: ActionRequestFields<A[K]>;
};

export function actionFields<A>(): ActionFields<A> {
  const actionsPath = join(process.cwd(), "server", "src", "actions.ts");
  const loaded = createRequire(join(process.cwd(), "package.json"))(actionsPath) as {
    Actions?: Record<string, { request: unknown }>;
  };
  if (loaded.Actions === undefined) {
    throw new Error(`actionFields: ${actionsPath} does not export \`Actions\``);
  }
  const fields: Record<string, Record<string, Described>> = {};
  for (const [action, definition] of Object.entries(loaded.Actions)) {
    fields[action] = describeRequest(definition.request);
  }
  return fields as ActionFields<A>;
}
