export function findDuplicateOffers(db, options = {}) {
  const limit = options.limit ?? 25;
  const groups = db.prepare(
    `SELECT issuer,
            COALESCE(card_last4, '') AS cardLast4,
            merchant,
            reward_text AS rewardText,
            COALESCE(expires_on, '') AS expiresOn,
            count(*) AS count,
            min(id) AS keepId,
            group_concat(id) AS ids
     FROM offers
     GROUP BY issuer, COALESCE(card_last4, ''), merchant, reward_text, COALESCE(expires_on, '')
     HAVING count(*) > 1
     ORDER BY count DESC, issuer, merchant
     LIMIT @limit`,
  ).all({ limit });

  return groups.map((group) => {
    const ids = String(group.ids).split(",").map((value) => Number(value));
    return {
      ...group,
      ids,
      deleteIds: ids.filter((id) => id !== group.keepId),
    };
  });
}

export function getDuplicateOfferSummary(db) {
  const row = db.prepare(
    `SELECT count(*) AS groups,
            COALESCE(sum(count - 1), 0) AS duplicateRows
     FROM (
       SELECT count(*) AS count
       FROM offers
       GROUP BY issuer, COALESCE(card_last4, ''), merchant, reward_text, COALESCE(expires_on, '')
       HAVING count(*) > 1
     )`,
  ).get();

  return {
    groupCount: Number(row.groups || 0),
    duplicateRows: Number(row.duplicateRows || 0),
  };
}

export function dedupeOffers(db, options = {}) {
  const summary = getDuplicateOfferSummary(db);
  const groups = findDuplicateOffers(db, { limit: options.limit ?? 25 });

  if (!options.apply) {
    return {
      applied: false,
      ...summary,
      deletedRows: 0,
      duplicateGroups: groups,
    };
  }

  const allGroups = findDuplicateOffers(db, { limit: Number.MAX_SAFE_INTEGER });
  const deleteIds = allGroups.flatMap((group) => group.deleteIds);
  if (!deleteIds.length) {
    return {
      applied: true,
      ...summary,
      deletedRows: 0,
      duplicateGroups: groups,
    };
  }

  const deleteStmt = db.prepare("DELETE FROM offers WHERE id = @id");
  db.exec("BEGIN");
  try {
    for (const id of deleteIds) deleteStmt.run({ id });
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  return {
    applied: true,
    ...summary,
    deletedRows: deleteIds.length,
    duplicateGroups: groups,
  };
}

export function formatDedupeOffersResult(result) {
  const header = result.applied
    ? `Deleted ${result.deletedRows} duplicate offer rows.`
    : `Dry run: ${result.duplicateRows} duplicate offer rows across ${result.groupCount} groups.`;
  const lines = [header];

  if (!result.applied && result.duplicateRows > 0) {
    lines.push("Run with --apply to delete duplicates, keeping the lowest id in each group.");
  }

  const preview = result.duplicateGroups.slice(0, 10);
  if (preview.length) {
    lines.push("");
    lines.push("Preview:");
    for (const group of preview) {
      const card = group.cardLast4 ? ` ****${group.cardLast4}` : "";
      lines.push(`- ${title(group.issuer)}${card}: ${group.merchant} - ${group.rewardText} (${group.count} copies, delete ${group.deleteIds.length})`);
    }
  }

  return lines.join("\n");
}

function title(value) {
  return String(value).slice(0, 1).toUpperCase() + String(value).slice(1);
}
