import { Collection, MikroORM, Ref } from '@mikro-orm/sqlite';
import {
  Entity,
  ManyToOne,
  OneToMany,
  PrimaryKey,
  Property,
  ReflectMetadataProvider,
} from '@mikro-orm/decorators/legacy';
import { mockLogger } from '../../helpers.js';

@Entity()
class Author {
  @PrimaryKey()
  id!: number;

  @OneToMany(() => Book, b => b.author)
  books = new Collection<Book>(this);
}

@Entity()
class Publisher {
  @PrimaryKey()
  id!: number;

  @Property()
  open!: boolean;
}

@Entity()
class Book {
  @PrimaryKey()
  id!: number;

  @ManyToOne(() => Author, { ref: true, nullable: true })
  author?: Ref<Author>;

  @ManyToOne(() => Publisher, { ref: true })
  publisher!: Ref<Publisher>;
}

let orm: MikroORM;

beforeAll(async () => {
  orm = await MikroORM.init({
    entities: [Author, Publisher, Book],
    dbName: ':memory:',
    metadataProvider: ReflectMetadataProvider,
  });
  await orm.schema.refresh();

  const em = orm.em.fork();
  await em.insertMany(Author, [{ id: 1 }, { id: 2 }, { id: 3 }]);
  await em.insertMany(Publisher, [
    { id: 10, open: true },
    { id: 11, open: false },
  ]);
  // book 100 is matched by the `open` branch only, book 101 by the `author` branch only
  await em.insertMany(Book, [
    { id: 100, author: 3, publisher: 10 },
    { id: 101, author: 2, publisher: 11 },
  ]);
});

afterAll(async () => {
  await orm.close(true);
});

test('populate where with `$or` keeps the disjunction when loading nested relations', async () => {
  const em = orm.em.fork();
  const authors = await em.find(Author, {}, { orderBy: { id: 'asc' } });
  const mock = mockLogger(orm);

  await em.populate(authors, ['books.publisher'], {
    strategy: 'select-in',
    where: {
      books: {
        $or: [{ publisher: { open: true } }, { author: { $in: [2] } }],
      },
    },
  });

  const queries: string[] = mock.mock.calls.map(call => call[0]);
  const bookQuery = queries.find(query => query.includes('from `book`'))!;
  const publisherQuery = queries.find(query => query.includes('from `publisher`'))!;

  // the collection query itself is right: both branches are there and both rows come back
  expect(bookQuery).toMatch(/`p1`\.`open` = true or `b0`\.`author_id` in \(2\)/);
  expect(bookQuery).toMatch(/2 results/);
  expect(authors.map(author => author.books.getIdentifiers())).toEqual([[], [101], [100]]);

  // the nested populate takes the `open` branch alone and applies it unconditionally, so the
  // publisher of the row that only matched the other branch is never fetched, and the reference
  // of a required relation ends up nulled
  const books = authors.flatMap(author => author.books.getItems());
  expect(books.map(book => [book.id, book.publisher?.id])).toEqual([
    [101, 11],
    [100, 10],
  ]);

  expect(publisherQuery).not.toMatch(/`open` = true/);
  expect(publisherQuery).toMatch(/2 results/);
});

test('populate where without `$or` loads the nested relation of every matched row', async () => {
  const em = orm.em.fork();
  const authors = await em.find(Author, {}, { orderBy: { id: 'asc' } });
  const mock = mockLogger(orm);

  await em.populate(authors, ['books.publisher'], {
    strategy: 'select-in',
    where: {
      books: {
        author: { $in: [2] },
      },
    },
  });

  const queries: string[] = mock.mock.calls.map(call => call[0]);
  const publisherQuery = queries.find(query => query.includes('from `publisher`'))!;

  expect(publisherQuery).not.toMatch(/`open` = true/);
  expect(authors.map(author => author.books.getIdentifiers())).toEqual([[], [101], []]);

  const books = authors.flatMap(author => author.books.getItems());
  expect(books.map(book => [book.id, book.publisher?.id])).toEqual([[101, 11]]);
});

test('populate where with `$or` does not turn one branch into a join condition', async () => {
  const em = orm.em.fork();
  const authors = await em.find(Author, {}, { orderBy: { id: 'asc' } });
  const mock = mockLogger(orm);

  // no `strategy`, so the nested to-one is loaded by the default `balanced` strategy, which joins it
  await em.populate(authors, ['books.publisher'], {
    where: {
      books: {
        $or: [{ publisher: { open: true } }, { author: { $in: [2] } }],
      },
    },
  });

  const queries: string[] = mock.mock.calls.map(call => call[0]);
  const bookQuery = queries.find(query => query.includes('from `book`'))!;

  expect(authors.map(author => author.books.getIdentifiers())).toEqual([[], [101], [100]]);

  // the where clause keeps the disjunction, but the joined nested relation repeats one of its
  // branches in the `on` clause, where it acts as a filter every row has to pass
  expect(bookQuery).toMatch(/`p1`\.`open` = true or `b0`\.`author_id` in \(2\)/);
  expect(bookQuery).not.toMatch(/on `b0`\.`publisher_id` = `p1`\.`id` and `p1`\.`open` = true/);
  expect(bookQuery).toMatch(/2 results/);
});

test('populate where without `$or` does not turn the condition into a join condition', async () => {
  const em = orm.em.fork();
  const authors = await em.find(Author, {}, { orderBy: { id: 'asc' } });
  const mock = mockLogger(orm);

  await em.populate(authors, ['books.publisher'], {
    where: {
      books: {
        author: { $in: [2] },
      },
    },
  });

  const queries: string[] = mock.mock.calls.map(call => call[0]);
  const bookQuery = queries.find(query => query.includes('from `book`'))!;

  expect(authors.map(author => author.books.getIdentifiers())).toEqual([[], [101], []]);
  expect(bookQuery).not.toMatch(/on `b0`\.`publisher_id` = `p1`\.`id` and /);
  expect(bookQuery).toMatch(/1 result/);
});
