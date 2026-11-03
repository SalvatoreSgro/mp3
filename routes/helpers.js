var ID_PATTERN = /^[0-9a-fA-F]{24}$/;

function isId(value) {
    return typeof value === 'string' && ID_PATTERN.test(value);
}

function send(res, status, message, data) {
    return res.status(status).json({ message: message, data: data === undefined ? {} : data });
}

function serverError(res) {
    return send(res, 500, 'Something went wrong on the server. Please try again later.');
}

function parseJsonParam(value) {
    if (value === undefined) return undefined;
    var parsed = JSON.parse(value);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('not a JSON object');
    }
    return parsed;
}

function parseCount(value) {
    if (value === undefined) return undefined;
    var n = Number(value);
    if (!Number.isInteger(n) || n < 0) throw new Error('not a whole number');
    return n;
}

function isBadQuery(err) {
    return err && (err.name === 'CastError' || err.name === 'MongoServerError');
}

module.exports = {
    isId: isId,
    send: send,
    serverError: serverError,
    parseJsonParam: parseJsonParam,
    parseCount: parseCount,
    isBadQuery: isBadQuery
};
