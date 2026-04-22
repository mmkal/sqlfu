export type VirtualFile = {
  name: string;
  content: string;
};

export type DemoVfsSnapshot = {
  definitions: string;
  migrations: VirtualFile[];
  queries: VirtualFile[];
};

const INITIAL_DEFINITIONS = `create table posts (
  id integer primary key,
  slug text not null unique,
  title text not null,
  body text not null,
  published integer not null
);

create view post_cards as
select id, slug, title, published
from posts;
`;

const INITIAL_QUERIES: VirtualFile[] = [
  {
    name: 'find-post-by-slug.sql',
    content: `select id, slug, title, published\nfrom posts\nwhere slug = :slug\nlimit 1;\n`,
  },
  {
    name: 'list-post-cards.sql',
    content: `select id, slug, title, published\nfrom post_cards\norder by id;\n`,
  },
];

export class DemoVfs {
  definitions: string = INITIAL_DEFINITIONS;
  migrations: VirtualFile[] = [];
  queries: VirtualFile[] = INITIAL_QUERIES.map((query) => ({...query}));

  snapshot(): DemoVfsSnapshot {
    return {
      definitions: this.definitions,
      migrations: this.migrations.map((file) => ({...file})),
      queries: this.queries.map((file) => ({...file})),
    };
  }

  writeDefinitions(sql: string) {
    this.definitions = sql.trimEnd() + '\n';
  }

  writeMigration(file: VirtualFile) {
    const existing = this.migrations.findIndex((migration) => migration.name === file.name);
    if (existing === -1) {
      this.migrations.push({...file});
      this.migrations.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      this.migrations[existing] = {...file};
    }
  }

  writeQuery(file: VirtualFile) {
    const existing = this.queries.findIndex((query) => query.name === file.name);
    if (existing === -1) {
      this.queries.push({...file});
      this.queries.sort((a, b) => a.name.localeCompare(b.name));
    } else {
      this.queries[existing] = {...file};
    }
  }

  renameQuery(oldName: string, newName: string) {
    const existing = this.queries.find((query) => query.name === oldName);
    if (!existing) {
      throw new Error(`Query ${oldName} not found`);
    }
    existing.name = newName;
    this.queries.sort((a, b) => a.name.localeCompare(b.name));
  }

  deleteQuery(name: string) {
    const index = this.queries.findIndex((query) => query.name === name);
    if (index !== -1) {
      this.queries.splice(index, 1);
    }
  }

  findQuery(id: string): VirtualFile | undefined {
    return this.queries.find((query) => query.name === `${id}.sql`);
  }
}
