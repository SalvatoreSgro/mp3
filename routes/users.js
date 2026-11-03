var User = require('../models/user');
var Task = require('../models/task');
var { isId, send, serverError, parseJsonParam, parseCount, isBadQuery } = require('./helpers');

function readUserBody(body) {
    body = body || {};
    if (typeof body.name !== 'string' || body.name.trim() === '') {
        return { error: 'A user must have a name.' };
    }
    if (typeof body.email !== 'string' || body.email.trim() === '') {
        return { error: 'A user must have an email.' };
    }
    var pending = body.pendingTasks === undefined ? [] : body.pendingTasks;
    if (!Array.isArray(pending)) {
        return { error: 'pendingTasks must be a list of task ids.' };
    }
    for (var i = 0; i < pending.length; i++) {
        if (!isId(pending[i])) {
            return { error: 'pendingTasks contains an invalid task id.' };
        }
    }
    return {
        name: body.name,
        email: body.email,
        pendingTasks: Array.from(new Set(pending))
    };
}

async function checkPendingTasks(ids) {
    if (ids.length === 0) return null;
    var tasks = await Task.find({ _id: { $in: ids } });
    if (tasks.length !== ids.length) {
        return { status: 404, message: 'One or more tasks in pendingTasks do not exist.' };
    }
    var hasCompleted = tasks.some(function (task) { return task.completed; });
    if (hasCompleted) {
        return { status: 400, message: 'A completed task cannot be in pendingTasks.' };
    }
    return null;
}

module.exports = function (router) {
    var usersRoute = router.route('/users');
    var userIdRoute = router.route('/users/:id');

    usersRoute.get(async function (req, res) {
        var where, sort, select, skip, limit;
        try {
            where = parseJsonParam(req.query.where) || {};
            sort = parseJsonParam(req.query.sort);
            select = parseJsonParam(req.query.select);
            skip = parseCount(req.query.skip);
            limit = parseCount(req.query.limit);
        } catch (err) {
            return send(res, 400, 'Invalid query parameters: where, sort and select must be JSON objects, skip and limit must be whole numbers.');
        }

        try {
            if (req.query.count === 'true') {
                var countQuery = User.countDocuments(where);
                if (skip !== undefined) countQuery.skip(skip);
                if (limit !== undefined) countQuery.limit(limit);
                return send(res, 200, 'OK', await countQuery.exec());
            }

            var query = User.find(where);
            if (sort) query.sort(sort);
            if (select) query.select(select);
            if (skip !== undefined) query.skip(skip);
            if (limit !== undefined) query.limit(limit);

            return send(res, 200, 'OK', await query.exec());
        } catch (err) {
            if (isBadQuery(err)) return send(res, 400, 'The query could not be run. Check your where, sort and select values.');
            return serverError(res);
        }
    });

    usersRoute.post(async function (req, res) {
        var input = readUserBody(req.body);
        if (input.error) return send(res, 400, input.error);

        try {
            if (await User.exists({ email: input.email })) {
                return send(res, 400, 'A user with that email already exists.');
            }

            var problem = await checkPendingTasks(input.pendingTasks);
            if (problem) return send(res, problem.status, problem.message);

            var newUser;
            await User.db.transaction(async function (session) {
                newUser = new User({
                    name: input.name,
                    email: input.email,
                    pendingTasks: input.pendingTasks
                });
                await newUser.save({ session: session });
                var userId = String(newUser._id);

                await User.updateMany(
                    { _id: { $ne: newUser._id }, pendingTasks: { $in: input.pendingTasks } },
                    { $pull: { pendingTasks: { $in: input.pendingTasks } } },
                    { session: session }
                );
                await Task.updateMany(
                    { _id: { $in: input.pendingTasks } },
                    { $set: { assignedUser: userId, assignedUserName: newUser.name } },
                    { session: session }
                );
            });

            return send(res, 201, 'User created', newUser);
        } catch (err) {
            if (err && err.code === 11000) return send(res, 400, 'A user with that email already exists.');
            return serverError(res);
        }
    });

    userIdRoute.get(async function (req, res) {
        var id = req.params.id;
        if (!isId(id)) return send(res, 404, 'User not found.');

        var select;
        try {
            select = parseJsonParam(req.query.select);
        } catch (err) {
            return send(res, 400, 'Invalid select parameter: it must be a JSON object.');
        }

        try {
            var query = User.findById(id);
            if (select) query.select(select);
            var user = await query.exec();
            if (!user) return send(res, 404, 'User not found.');
            return send(res, 200, 'OK', user);
        } catch (err) {
            if (isBadQuery(err)) return send(res, 400, 'Invalid select parameter.');
            return serverError(res);
        }
    });

    userIdRoute.put(async function (req, res) {
        var id = req.params.id;

        try {
            if (!isId(id)) return send(res, 404, 'User not found.');
            var user = await User.findById(id);
            if (!user) return send(res, 404, 'User not found.');

            var input = readUserBody(req.body);
            if (input.error) return send(res, 400, input.error);

            if (await User.exists({ email: input.email, _id: { $ne: id } })) {
                return send(res, 400, 'A user with that email already exists.');
            }

            var problem = await checkPendingTasks(input.pendingTasks);
            if (problem) return send(res, problem.status, problem.message);

            var oldIds = user.pendingTasks.map(String);
            var newIds = input.pendingTasks;
            var removedIds = oldIds.filter(function (taskId) { return newIds.indexOf(taskId) === -1; });

            await User.db.transaction(async function (session) {
                await Task.updateMany(
                    { _id: { $in: removedIds }, assignedUser: id },
                    { $set: { assignedUser: '', assignedUserName: 'unassigned' } },
                    { session: session }
                );

                await User.updateMany(
                    { _id: { $ne: id }, pendingTasks: { $in: newIds } },
                    { $pull: { pendingTasks: { $in: newIds } } },
                    { session: session }
                );

                await Task.updateMany(
                    { _id: { $in: newIds } },
                    { $set: { assignedUser: id, assignedUserName: input.name } },
                    { session: session }
                );

                await Task.updateMany(
                    { assignedUser: id },
                    { $set: { assignedUserName: input.name } },
                    { session: session }
                );

                user.name = input.name;
                user.email = input.email;
                user.pendingTasks = newIds;
                await user.save({ session: session });
            });

            return send(res, 200, 'User updated', user);
        } catch (err) {
            if (err && err.code === 11000) return send(res, 400, 'A user with that email already exists.');
            return serverError(res);
        }
    });

    userIdRoute.delete(async function (req, res) {
        var id = req.params.id;

        try {
            if (!isId(id)) return send(res, 404, 'User not found.');
            var user = await User.findById(id);
            if (!user) return send(res, 404, 'User not found.');

            await User.db.transaction(async function (session) {
                await Task.updateMany(
                    { assignedUser: id },
                    { $set: { assignedUser: '', assignedUserName: 'unassigned' } },
                    { session: session }
                );
                await User.deleteOne({ _id: id }, { session: session });
            });

            return res.status(204).end();
        } catch (err) {
            return serverError(res);
        }
    });

    return router;
};