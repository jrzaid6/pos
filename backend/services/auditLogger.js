const writeAudit = async (client, { userId, action, targetType, targetId = null, details = null }) => {
    await client.query(
        `INSERT INTO audit_logs (user_id, action, target_type, target_id, details)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId || null, action, targetType || null, targetId, details == null ? null : JSON.stringify(details)]
    );
};

module.exports = { writeAudit };
