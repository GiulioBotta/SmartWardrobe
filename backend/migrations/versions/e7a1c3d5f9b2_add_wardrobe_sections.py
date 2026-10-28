"""add wardrobe_sections and collection_items for the grouped wardrobe

Revision ID: e7a1c3d5f9b2
Revises: d2f4a6b8c0e1
Create Date: 2026-10-28

"""

from collections.abc import Sequence

from alembic import op

revision: str = "e7a1c3d5f9b2"
down_revision: str | None = "d2f4a6b8c0e1"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Only the user's choices live here (order, hidden categories switched on, collections);
    # which category an item is in comes from its type, so nothing is backfilled.
    op.execute(
        """
        CREATE TABLE wardrobe_sections (
            id UUID PRIMARY KEY,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            kind VARCHAR(20) NOT NULL,
            key VARCHAR(30),
            name VARCHAR(50),
            position INTEGER NOT NULL,
            enabled BOOLEAN NOT NULL DEFAULT true,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            CONSTRAINT uq_wardrobe_sections_user_key UNIQUE (user_id, key)
        )
        """
    )
    op.execute("CREATE INDEX ix_wardrobe_sections_user_id ON wardrobe_sections (user_id)")
    op.execute(
        "CREATE UNIQUE INDEX uq_wardrobe_sections_user_collection_name "
        "ON wardrobe_sections (user_id, lower(name)) WHERE kind = 'collection'"
    )
    op.execute(
        """
        CREATE TABLE collection_items (
            section_id UUID NOT NULL REFERENCES wardrobe_sections(id) ON DELETE CASCADE,
            item_id UUID NOT NULL REFERENCES clothing_items(id) ON DELETE CASCADE,
            added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            PRIMARY KEY (section_id, item_id)
        )
        """
    )
    op.execute("CREATE INDEX ix_collection_items_item_id ON collection_items (item_id)")


def downgrade() -> None:
    op.execute("DROP TABLE IF EXISTS collection_items")
    op.execute("DROP TABLE IF EXISTS wardrobe_sections")
