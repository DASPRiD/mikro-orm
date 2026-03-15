import { MikroORM } from '@mikro-orm/sqlite';
import { BeforeCreate, Check, Embeddable, Embedded, Entity, Enum, Index, ManyToMany, ManyToOne, OneToMany, OneToOne, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/es';
import { Collection, EventArgs } from '@mikro-orm/core';

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
 * All decorators in the class share the same `_metadata` reference so when it is `void 0`
 * no metadata is propagated from field/method decorators to the class decorator.
 *
 * Fix: @mikro-orm/decorators/es installs a Symbol.metadata polyfill as a module-level
 * side-effect.  ES imports are resolved before the importing module's body runs, so by
 * the time any entity class is defined the symbol is already present and tsc's conditional
 * produces `Object.create(null)` instead of `void 0`.
 */

// ---------------------------------------------------------------------------
// Entity classes defined here exercise the full decorator chain.
// They are compiled by SWC inside vitest, but the Symbol.metadata polyfill
// is what makes the equivalent tsc-compiled output work in production.
// ---------------------------------------------------------------------------

@Entity()
@Index({ properties: ['name'] })
@Unique({ properties: ['email'] })
class PolyfillAuthor {
  @PrimaryKey({ type: 'integer' })
  id!: number;

  @Property({ type: 'string' })
  @Index({ name: 'author_name_idx' })
  name!: string;

  @Property({ type: 'string' })
  email!: string;

  @Check<PolyfillAuthor>({ expression: c => `${c.age} > 0` })
  @Property({ type: 'integer', nullable: true })
  age?: number;

  @Property({ type: 'string', nullable: true })
  bio?: string;

  @ManyToOne(() => PolyfillAuthor, { nullable: true })
  mentor?: PolyfillAuthor;

  @OneToMany(() => PolyfillBook, (b: PolyfillBook) => b.author)
  books = new Collection<PolyfillBook>(this);

  @ManyToMany(() => PolyfillAuthor, undefined, { pivotTable: 'author_friends' })
  friends = new Collection<PolyfillAuthor>(this);

  hookCalled = false;

  @BeforeCreate()
  onBeforeCreate(_args: EventArgs<this>) {
    this.hookCalled = true;
  }
}

@Entity()
class PolyfillBook {
  @PrimaryKey({ type: 'integer' })
  id!: number;

  @Property({ type: 'string' })
  title!: string;

  @ManyToOne(() => PolyfillAuthor)
  author!: PolyfillAuthor;

  @OneToOne(() => PolyfillAuthor, { nullable: true })
  dedicatee?: PolyfillAuthor;

  @Enum({ items: () => ['draft', 'published'] })
  status!: string;
}

@Embeddable()
class PolyfillAddress {
  @Property({ type: 'string' })
  street!: string;

  @Property({ type: 'string' })
  city!: string;
}

@Entity()
class PolyfillOrg {
  @PrimaryKey({ type: 'integer' })
  id!: number;

  @Embedded(() => PolyfillAddress)
  address!: PolyfillAddress;
}

// ---------------------------------------------------------------------------

describe('ES decorators with Symbol.metadata polyfill', () => {
  /**
   * The polyfill is installed as a side-effect of the `es/index.ts` module.
   * ES imports are hoisted, so by the time this test module's body runs the
   * polyfill has already executed.
   */
  test('Symbol.metadata is defined after importing @mikro-orm/decorators/es', () => {
    expect(Symbol.metadata).toBeDefined();
    expect(typeof Symbol.metadata).toBe('symbol');
  });

  /**
   * Reproduce the exact conditional TypeScript emits for ES-decorated classes.
   * After the polyfill this should produce a proper shared object, not void 0.
   */
  test('tsc-generated _metadata pattern produces a shared object after the polyfill', () => {
    // This is verbatim what TypeScript generates inside the class static block:
    const _metadata = typeof Symbol === 'function' && Symbol.metadata ? Object.create(null) : void 0;
    expect(_metadata).not.toBeUndefined();
    expect(_metadata).not.toBeNull();
    expect(typeof _metadata).toBe('object');
  });

  /**
   * Full end-to-end check: initialise an ORM instance with entities that use
   * every decorator family and verify that the resulting metadata is complete.
   */
  describe('complete metadata after ORM initialisation', () => {
    let orm: MikroORM;

    beforeAll(async () => {
      orm = await MikroORM.init({
        entities: [PolyfillAuthor, PolyfillBook, PolyfillAddress, PolyfillOrg],
        dbName: ':memory:',
      });
    });

    afterAll(() => orm.close(true));

    test('entity properties are discovered', () => {
      const meta = orm.getMetadata().get(PolyfillAuthor);
      expect(meta.properties.id).toBeDefined();
      expect(meta.properties.name).toBeDefined();
      expect(meta.properties.email).toBeDefined();
      expect(meta.properties.age).toBeDefined();
      expect(meta.properties.books).toBeDefined();
      expect(meta.properties.friends).toBeDefined();
      expect(meta.properties.mentor).toBeDefined();
    });

    test('check constraints are discovered', () => {
      const meta = orm.getMetadata().get(PolyfillAuthor);
      expect(meta.checks.length).toBeGreaterThan(0);
    });

    test('indexes and uniques are discovered', () => {
      const meta = orm.getMetadata().get(PolyfillAuthor);
      expect(meta.indexes.length).toBeGreaterThan(0);
      expect(meta.uniques.length).toBeGreaterThan(0);
    });

    test('enum property is discovered', () => {
      const meta = orm.getMetadata().get(PolyfillBook);
      expect(meta.properties.status).toBeDefined();
      expect(meta.properties.status.enum).toBe(true);
    });

    test('embeddable is discovered', () => {
      const meta = orm.getMetadata().get(PolyfillOrg);
      expect(meta.properties.address).toBeDefined();
    });

    test('hooks are discovered', () => {
      const meta = orm.getMetadata().get(PolyfillAuthor);
      expect(meta.hooks.beforeCreate).toBeDefined();
      expect(meta.hooks.beforeCreate!.length).toBeGreaterThan(0);
    });

    test('entity can be persisted and hooks are called', async () => {
      await orm.schema.create();
      const author = orm.em.create(PolyfillAuthor, { name: 'Alice', email: 'alice@example.com' });
      await orm.em.flush();
      expect(author.hookCalled).toBe(true);
      expect(author.id).toBeDefined();
    });
  });
});
