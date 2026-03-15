import {
  BeforeCreate,
  Check,
  Embedded,
  Enum,
  Index,
  ManyToMany,
  ManyToOne,
  OneToMany,
  OneToOne,
  PrimaryKey,
  Property,
  Unique,
} from '@mikro-orm/decorators/es';

/**
 * Reproduces: TypeError: Cannot convert undefined or null to object at Object.hasOwn
 *
 * When TypeScript compiles entities to JS (e.g. ES2023/ES2024 target), the emitted code
 * conditionally initialises the decorator metadata object only when Symbol.metadata is
 * available:
 *
 *   const _metadata = typeof Symbol === "function" && Symbol.metadata
 *     ? Object.create(null)
 *     : void 0;
 *
 * Because Symbol.metadata is not a built-in in current Node.js runtimes, _metadata ends
 * up as `undefined` and every decorator receives `context.metadata === undefined`.
 * The decorators in @mikro-orm/decorators/es then crash when they try to read or write
 * properties on that value.
 *
 * The helper below creates a decorator context that matches what tsc produces in that
 * situation, so the failing code path can be exercised directly from within the test
 * suite (which normally runs under SWC, which does polyfill the metadata object).
 */

// Reproduce the exact condition from tsc-generated code:
// Symbol.metadata is undefined in Node.js, so _metadata becomes void 0.
const TSC_METADATA = typeof Symbol === 'function' && Symbol.metadata ? Object.create(null) : void 0;

function makeFieldContext<T extends object>(name: keyof T & string): ClassFieldDecoratorContext<T, unknown> {
  return {
    kind: 'field',
    name: name as keyof T,
    static: false,
    private: false,
    metadata: TSC_METADATA as unknown as DecoratorMetadataObject,
    access: {
      has: (obj: T) => name in obj,
      get: (obj: T) => (obj as Record<string, unknown>)[name],
      set: (obj: T, value: unknown) => {
        (obj as Record<string, unknown>)[name] = value;
      },
    },
    addInitializer: () => {},
  };
}

function makeMethodContext<T extends object>(name: keyof T & string): ClassMethodDecoratorContext<T, (...args: any[]) => any> {
  return {
    kind: 'method',
    name: name as keyof T,
    static: false,
    private: false,
    metadata: TSC_METADATA as unknown as DecoratorMetadataObject,
    access: {
      has: (obj: T) => name in obj,
      get: (obj: T) => (obj as Record<string, (...args: any[]) => any>)[name],
    },
    addInitializer: () => {},
  };
}

function makeClassContext<T extends abstract new (...args: any) => any>(name: string): ClassDecoratorContext<T> {
  return {
    kind: 'class',
    name,
    metadata: TSC_METADATA as unknown as DecoratorMetadataObject,
    addInitializer: () => {},
  };
}

describe('ES decorators with undefined context.metadata (tsc-compiled code)', () => {
  // Sanity-check: ensure the helper actually produces undefined metadata,
  // i.e. the test is exercising the broken code path.
  test('Symbol.metadata is not available, so TSC_METADATA is undefined', () => {
    expect(Symbol.metadata).toBeUndefined();
    expect(TSC_METADATA).toBeUndefined();
  });

  test('@PrimaryKey() does not throw when context.metadata is undefined', () => {
    expect(() =>
      PrimaryKey({ type: 'integer' })(undefined, makeFieldContext<{ id: number }>('id')),
    ).not.toThrow();
  });

  test('@Property() does not throw when context.metadata is undefined', () => {
    expect(() =>
      Property({ type: 'string' })(undefined, makeFieldContext<{ name: string }>('name')),
    ).not.toThrow();
  });

  test('@Enum() does not throw when context.metadata is undefined', () => {
    expect(() =>
      Enum({})(undefined, makeFieldContext<{ status: string }>('status')),
    ).not.toThrow();
  });

  test('@ManyToOne() does not throw when context.metadata is undefined', () => {
    expect(() =>
      ManyToOne({ entity: () => Object })(undefined, makeFieldContext<{ owner: object }>('owner')),
    ).not.toThrow();
  });

  test('@OneToMany() does not throw when context.metadata is undefined', () => {
    expect(() =>
      OneToMany({ entity: () => Object, mappedBy: 'foo' })(undefined, makeFieldContext<{ items: object[] }>('items')),
    ).not.toThrow();
  });

  test('@OneToOne() does not throw when context.metadata is undefined', () => {
    expect(() =>
      OneToOne({ entity: () => Object })(undefined, makeFieldContext<{ rel: object }>('rel')),
    ).not.toThrow();
  });

  test('@ManyToMany() does not throw when context.metadata is undefined', () => {
    expect(() =>
      ManyToMany({ entity: () => Object })(undefined, makeFieldContext<{ rels: object[] }>('rels')),
    ).not.toThrow();
  });

  test('@Embedded() does not throw when context.metadata is undefined', () => {
    expect(() =>
      Embedded(() => Object)(undefined, makeFieldContext<{ embedded: object }>('embedded')),
    ).not.toThrow();
  });

  test('@Check() does not throw when context.metadata is undefined', () => {
    expect(() =>
      Check<{ name: string }>({ expression: 'name IS NOT NULL' })(undefined, makeFieldContext<{ name: string }>('name')),
    ).not.toThrow();
  });

  test('@Index() does not throw when context.metadata is undefined', () => {
    expect(() =>
      Index()(undefined, makeFieldContext<{ name: string }>('name')),
    ).not.toThrow();
  });

  test('@Unique() does not throw when context.metadata is undefined', () => {
    expect(() =>
      Unique()(undefined, makeFieldContext<{ email: string }>('email')),
    ).not.toThrow();
  });

  test('@BeforeCreate() does not throw when context.metadata is undefined', () => {
    expect(() =>
      BeforeCreate()(() => {}, makeMethodContext<{ onCreate: () => void }>('onCreate')),
    ).not.toThrow();
  });
});
