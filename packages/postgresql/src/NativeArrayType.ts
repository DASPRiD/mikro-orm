import type { Constructor, EntityProperty, Platform, TransformContext } from '@mikro-orm/core';
import { Type } from '@mikro-orm/core';

type InnerJSType<T extends Type<any, any>> = T extends Type<infer JS, any> ? NonNullable<JS> : never;

/**
 * Maps a PostgreSQL native typed array column (e.g. `integer[]`, `decimal(10,2)[]`) to a JS array.
 *
 * Unlike the core `ArrayType` which always uses a `text[]` column and marshalls values to/from
 * a delimited string, `NativeArrayType` derives the element column type from the supplied inner
 * type and appends `[]`, producing a proper PostgreSQL typed array column. Per-element conversion
 * is delegated to the inner type, so features like `DecimalType`'s precision-aware comparison
 * continue to work on each element.
 *
 * The `nullable` decorator/defineEntity option applies to the array column itself (i.e. the
 * column may be `NULL`), while all other property options (e.g. `precision`, `scale`) are
 * forwarded to the inner type when determining the element column type.
 *
 * @example
 * // integer[] column
 * @Property({ type: new NativeArrayType(types.integer) })
 * ids!: number[];
 *
 * @example
 * // decimal(10,2)[] column
 * @Property({ type: new NativeArrayType(new DecimalType('number')), precision: 10, scale: 2 })
 * prices!: number[];
 */
export class NativeArrayType<Inner extends Type<any, any>> extends Type<
  InnerJSType<Inner>[] | null,
  InnerJSType<Inner>[] | null
> {
  readonly #inner: Inner;

  constructor(inner: Constructor<Inner> | Inner) {
    super();
    this.#inner = inner instanceof Type ? inner : new (inner as Constructor<Inner>)();
  }

  override getColumnType(prop: EntityProperty, platform: Platform): string {
    // Forward the full property so the inner type can read precision/scale/length etc.,
    // but strip autoincrement since serial/bigserial make no sense as element types.
    const innerProp = { ...prop, autoincrement: false };
    this.#inner.prop = innerProp;
    this.#inner.platform = platform;
    return `${this.#inner.getColumnType(innerProp, platform)}[]`;
  }

  override convertToDatabaseValue(
    value: InnerJSType<Inner>[] | null,
    platform: Platform,
    context?: TransformContext,
  ): InnerJSType<Inner>[] | null {
    if (value == null) {
      return value;
    }

    return value.map(item => this.#inner.convertToDatabaseValue(item as any, platform, context) as InnerJSType<Inner>);
  }

  override convertToJSValue(
    value: InnerJSType<Inner>[] | null,
    platform: Platform,
  ): InnerJSType<Inner>[] | null {
    if (value == null) {
      return value;
    }

    return value.map(item => this.#inner.convertToJSValue(item as any, platform) as InnerJSType<Inner>);
  }

  override compareAsType(): string {
    return 'array';
  }

  override toJSON(value: InnerJSType<Inner>[] | null, platform: Platform): InnerJSType<Inner>[] | null {
    if (value == null) {
      return value;
    }

    return value.map(item => this.#inner.toJSON(item as any, platform) as InnerJSType<Inner>);
  }
}
