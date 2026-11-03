var User = require('../models/user');
var Task = require('../models/task');
var { isId, send, serverError, parseJsonParam, isBadQuery, parseCount } = require('./helpers');

module.exports = function (router) {
    var tasksRoute = router.route('/tasks');
    var taskIdRoute = router.route('/tasks/:id');

    tasksRoute.get(async function (req, res) {
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
                var countQuery = Task.countDocuments(where);
                if (skip !== undefined) countQuery.skip(skip);
                if (limit !== undefined) countQuery.limit(limit);
                var count = await countQuery.exec();
                return send(res, 200, 'OK', count);
            }

            var query = Task.find(where);
            if (sort) query.sort(sort);
            if (select) query.select(select);
            if (skip !== undefined) query.skip(skip);
            query.limit(limit !== undefined ? limit : 100);

            var tasks = await query.exec();
            return send(res, 200, 'OK', tasks);
        } catch (err) {
            if (isBadQuery(err)) return send(res, 400, 'The query could not be run. Check your parameters.');
            return serverError(res);
        }
    });

    tasksRoute.post(async function (req, res) {
        var body = req.body || {};

        if (typeof body.name !== 'string' || body.name.trim() === '') {
            return send(res, 400, 'A task must have a name.');
        }

        if (typeof body.deadline !== 'string' && typeof body.deadline !== 'number') {
            return send(res, 400, 'A task must have a deadline.');
        }
        var deadlineValue = /^\d+$/.test(String(body.deadline)) ? Number(body.deadline) : body.deadline;
        var deadline = new Date(deadlineValue);
        if (body.deadline === '' || isNaN(deadline.getTime())) {
            return send(res, 400, 'deadline must be a valid date.');
        }

        var description = '';
        if (body.description !== undefined) {
            if (typeof body.description !== 'string') {
                return send(res, 400, 'description must be text.');
            }
            description = body.description;
        }

        var completed = false;
        if (body.completed !== undefined) {
            if (body.completed === true || body.completed === 'true') completed = true;
            else if (body.completed === false || body.completed === 'false') completed = false;
            else return send(res, 400, 'completed must be true or false.');
        }

        var assignedUser = body.assignedUser === undefined ? '' : body.assignedUser;
        if (typeof assignedUser !== 'string' || (assignedUser !== '' && !isId(assignedUser))) {
            return send(res, 400, 'assignedUser is not a valid user id.');
        }
        if (body.assignedUserName !== undefined && typeof body.assignedUserName !== 'string') {
            return send(res, 400, 'assignedUserName must be text.');
        }
        if (assignedUser === '' && body.assignedUserName !== undefined &&
            body.assignedUserName !== '' && body.assignedUserName !== 'unassigned') {
            return send(res, 400, 'assignedUserName was given but assignedUser is empty.');
        }

        try {
            var assignedUserName = 'unassigned';
            if (assignedUser !== '') {
                var user = await User.findById(assignedUser);
                if (!user) {
                    return send(res, 404, 'The assigned user does not exist.');
                }
                if (body.assignedUserName !== undefined && body.assignedUserName !== user.name) {
                    return send(res, 400, 'assignedUserName does not match the assigned user.');
                }
                assignedUserName = user.name;
            }

            var newTask;
            await Task.db.transaction(async function (session) {
                newTask = new Task({
                    name: body.name,
                    description: description,
                    deadline: deadline,
                    completed: completed,
                    assignedUser: assignedUser,
                    assignedUserName: assignedUserName
                });
                await newTask.save({ session: session });

                if (assignedUser !== '' && !completed) {
                    await User.updateOne(
                        { _id: assignedUser },
                        { $addToSet: { pendingTasks: String(newTask._id) } },
                        { session: session }
                    );
                }
            });

            return send(res, 201, 'Task created', newTask);
        } catch (err) {
            return serverError(res);
        }
    });

    taskIdRoute.get(async function (req, res) {
        var id = req.params.id;

        if (!isId(id)) {
            return send(res, 404, 'Task not found.');
        }

        var select;
        try {
            select = parseJsonParam(req.query.select);
        } catch (err) {
            return send(res, 400, 'select must be a JSON object.');
        }

        try {
            var query = Task.findById(id);
            if (select) query.select(select);
            var task = await query.exec();
            if (!task) {
                return send(res, 404, 'Task not found.');
            }
            return send(res, 200, 'OK', task);
        } catch (err) {
            if (isBadQuery(err)) return send(res, 400, 'select could not be applied.');
            return serverError(res);
        }
    });

    taskIdRoute.put(async function (req, res) {
        var id = req.params.id;
        var body = req.body || {};

        try {
            if (!isId(id)) {
                return send(res, 404, 'Task not found.');
            }
            var task = await Task.findById(id);
            if (!task) {
                return send(res, 404, 'Task not found.');
            }

            if (typeof body.name !== 'string' || body.name.trim() === '') {
                return send(res, 400, 'A task must have a name.');
            }

            if (typeof body.deadline !== 'string' && typeof body.deadline !== 'number') {
                return send(res, 400, 'A task must have a deadline.');
            }
            var deadlineValue = /^\d+$/.test(String(body.deadline)) ? Number(body.deadline) : body.deadline;
            var deadline = new Date(deadlineValue);
            if (body.deadline === '' || isNaN(deadline.getTime())) {
                return send(res, 400, 'deadline must be a valid date.');
            }

            var description = '';
            if (body.description !== undefined) {
                if (typeof body.description !== 'string') {
                    return send(res, 400, 'description must be text.');
                }
                description = body.description;
            }

            var completed = false;
            if (body.completed !== undefined) {
                if (body.completed === true || body.completed === 'true') completed = true;
                else if (body.completed === false || body.completed === 'false') completed = false;
                else return send(res, 400, 'completed must be true or false.');
            }

            var assignedUser = body.assignedUser === undefined ? '' : body.assignedUser;
            if (typeof assignedUser !== 'string' || (assignedUser !== '' && !isId(assignedUser))) {
                return send(res, 400, 'assignedUser is not a valid user id.');
            }
            if (body.assignedUserName !== undefined && typeof body.assignedUserName !== 'string') {
                return send(res, 400, 'assignedUserName must be text.');
            }
            if (assignedUser === '' && body.assignedUserName !== undefined &&
                body.assignedUserName !== '' && body.assignedUserName !== 'unassigned') {
                return send(res, 400, 'assignedUserName was given but assignedUser is empty.');
            }

            var assignedUserName = 'unassigned';
            if (assignedUser !== '') {
                var user = await User.findById(assignedUser);
                if (!user) {
                    return send(res, 404, 'The assigned user does not exist.');
                }
                if (body.assignedUserName !== undefined && body.assignedUserName !== user.name) {
                    return send(res, 400, 'assignedUserName does not match the assigned user.');
                }
                assignedUserName = user.name;
            }

            await Task.db.transaction(async function (session) {
                await User.updateMany(
                    { _id: { $ne: assignedUser === '' ? null : assignedUser }, pendingTasks: id },
                    { $pull: { pendingTasks: id } },
                    { session: session }
                );

                if (assignedUser !== '') {
                    if (completed) {
                        await User.updateOne(
                            { _id: assignedUser },
                            { $pull: { pendingTasks: id } },
                            { session: session }
                        );
                    } else {
                        await User.updateOne(
                            { _id: assignedUser },
                            { $addToSet: { pendingTasks: id } },
                            { session: session }
                        );
                    }
                }

                task.name = body.name;
                task.description = description;
                task.deadline = deadline;
                task.completed = completed;
                task.assignedUser = assignedUser;
                task.assignedUserName = assignedUserName;
                await task.save({ session: session });
            });

            return send(res, 200, 'Task updated', task);
        } catch (err) {
            return serverError(res);
        }
    });

    taskIdRoute.delete(async function (req, res) {
        var id = req.params.id;

        try {
            if (!isId(id)) {
                return send(res, 404, 'Task not found.');
            }
            var task = await Task.findById(id);
            if (!task) {
                return send(res, 404, 'Task not found.');
            }

            await Task.db.transaction(async function (session) {
                await User.updateMany(
                    { pendingTasks: id },
                    { $pull: { pendingTasks: id } },
                    { session: session }
                );
                await Task.deleteOne({ _id: id }, { session: session });
            });

            return send(res, 200, 'Task deleted', task);
        } catch (err) {
            return serverError(res);
        }
    });

    return router;
};