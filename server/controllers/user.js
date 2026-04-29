import User from '../models/user.js'
import Lead from '../models/lead.js'
import { createError, isValidDate } from '../utils/error.js'
import validator from 'validator'
import bcrypt from 'bcryptjs'

const USER_FIELDS = ['firstName', 'lastName', 'username', 'phone', 'city', 'CNIC', 'email']
const CLIENT_REQUIRED_FIELDS = ['firstName', 'lastName', 'username', 'phone']
const EMPLOYEE_REQUIRED_FIELDS = [...CLIENT_REQUIRED_FIELDS, 'password']
const USER_ROLES = ['client', 'employee', 'manager', 'super_admin']

const pickUserFields = (body) => {
    return USER_FIELDS.reduce((payload, field) => {
        if (body[field] !== undefined) {
            payload[field] = typeof body[field] === 'string' ? body[field].trim() : body[field]
        }

        return payload
    }, {})
}

const getMissingFields = (data, fields) => {
    return fields.filter((field) => !String(data[field] ?? '').trim())
}

const isInvalidUserId = (userId) => !validator.isMongoId(String(userId ?? ''))

const validateUserFields = (data, requiredFields = []) => {
    const missingFields = getMissingFields(data, requiredFields)
    if (missingFields.length > 0) return `Missing required fields: ${missingFields.join(', ')}`

    if ('username' in data && !String(data.username ?? '').trim()) return 'Username is required'
    if ('phone' in data && !String(data.phone ?? '').trim()) return 'Phone is required'
    if (data.email && !validator.isEmail(data.email)) return 'Invalid Email Address'

    return null
}

const ensureUniqueUserFields = async ({ username, email, userId }) => {
    const excludedUserFilter = userId ? { _id: { $ne: userId } } : {}

    if (username) {
        const existingUsername = await User.findOne({ username, ...excludedUserFilter })
        if (existingUsername) return 'Username already exist'
    }

    if (email) {
        const existingEmail = await User.findOne({ email, ...excludedUserFilter })
        if (existingEmail) return 'Email already exist'
    }

    return null
}


export const getUsers = async (req, res, next) => {
    try {

        const users = await User.find()
        res.status(200).json({ result: users, message: 'users fetched seccessfully', success: true })

    } catch (err) {
        next(createError(500, err.message))

    }
}

export const getUser = async (req, res, next) => {
    try {

        const { userId } = req.params
        if (isInvalidUserId(userId)) return next(createError(400, 'Invalid user id'))

        const findedUser = await User.findById(userId)
        if (!findedUser) return next(createError(404, 'User not exist'))

        res.status(200).json({ result: findedUser, message: 'user fetched seccessfully', success: true })

    } catch (err) {
        next(createError(500, err.message))

    }
}

export const filterUser = async (req, res, next) => {
    const { startingDate, endingDate, ...filters } = req.query;
    try {
        let query = await User.find(filters)

        // Check if startingDate is provided and valid
        if (startingDate && isValidDate(startingDate)) {
            const startDate = new Date(startingDate);
            startDate.setHours(0, 0, 0, 0);

            // Add createdAt filtering for startingDate
            query = query.where('createdAt').gte(startDate);
        }

        // Check if endingDate is provided and valid
        if (endingDate && isValidDate(endingDate)) {
            const endDate = new Date(endingDate);
            endDate.setHours(23, 59, 59, 999);

            // Add createdAt filtering for endingDate
            if (query.model.modelName === 'User') { // Check if the query has not been executed yet
                query = query.where('createdAt').lte(endDate);
            }
        }
        if (query.length > 0) {
            query = await query.populate('userId').exec();
        }
        res.status(200).json({ result: query });

    } catch (error) {
        next(createError(500, error.message));
    }
};


export const getClients = async (req, res, next) => {
    try {

        const findedClients = await User.find({ role: 'client' })
        res.status(200).json({ result: findedClients, message: 'clients fetched seccessfully', success: true })

    } catch (err) {
        next(createError(500, err.message))

    }
}

export const getEmployeeClients = async (req, res, next) => {
    try {
        let allClients = await User.find({ role: 'client' })
        const employeeLeads = await Lead.find({ allocatedTo: { $in: req.user?._id }, isArchived: false })

        // Filter clients based on the condition
        allClients = allClients.filter((client) => {
            return employeeLeads.findIndex(lead => lead.clientPhone.toString() === client.phone.toString()) !== -1
        });

        res.status(200).json({ result: allClients, message: 'clients fetched successfully', success: true });
    } catch (err) {
        next(createError(500, err.message));
    }
};

export const getEmployees = async (req, res, next) => {
    try {

        const findedEmployees = await User.find({ role: 'employee' })
        res.status(200).json({ result: findedEmployees, message: 'employees fetched seccessfully', success: true })

    } catch (err) {
        next(createError(500, err.message))
    }
}

export const createClient = async (req, res, next) => {
    try {
        const userData = pickUserFields(req.body)
        const validationError = validateUserFields(userData, CLIENT_REQUIRED_FIELDS)
        if (validationError) return next(createError(400, validationError))

        const uniquenessError = await ensureUniqueUserFields(userData)
        if (uniquenessError) return next(createError(400, uniquenessError))

        const result = await User.create({ ...userData, role: 'client' })
        res.status(200).json({ result, message: 'client created seccessfully', success: true })

    } catch (err) {
        next(createError(500, err.message))
    }
}
export const createEmployee = async (req, res, next) => {
    try {
        const userData = pickUserFields(req.body)
        const password = String(req.body.password ?? '').trim()
        const validationError = validateUserFields({ ...userData, password }, EMPLOYEE_REQUIRED_FIELDS)
        if (validationError) return next(createError(400, validationError))

        const uniquenessError = await ensureUniqueUserFields(userData)
        if (uniquenessError) return next(createError(400, uniquenessError))

        const hashedPassword = await bcrypt.hash(password, 12)

        const result = await User.create({ ...userData, password: hashedPassword, role: 'employee' })
        res.status(200).json({ result, message: 'employee created seccessfully', success: true })

    } catch (err) {
        next(createError(500, err.message))
    }
}

export const updateUser = async (req, res, next) => {
    try {
        const { userId } = req.params
        if (isInvalidUserId(userId)) return next(createError(400, 'Invalid user id'))

        const userData = pickUserFields(req.body)

        if (Object.keys(userData).length === 0) return next(createError(400, 'No valid fields provided'))

        const validationError = validateUserFields(userData)
        if (validationError) return next(createError(400, validationError))

        const findedUser = await User.findById(userId)
        if (!findedUser) return next(createError(404, 'User not exist'))

        const uniquenessError = await ensureUniqueUserFields({ ...userData, userId })
        if (uniquenessError) return next(createError(400, uniquenessError))

        const updatedUser = await User.findByIdAndUpdate(userId, { $set: userData }, { new: true, runValidators: true })
        res.status(200).json({ result: updatedUser, message: 'User updated successfully', success: true })

    } catch (err) {
        next(createError(500, err.message))
    }
}

export const updateRole = async (req, res, next) => {
    try {

        const { userId } = req.params
        const { role } = req.body
        if (isInvalidUserId(userId)) return next(createError(400, 'Invalid user id'))
        if (!USER_ROLES.includes(role)) return next(createError(400, 'Invalid role'))

        const findedUser = await User.findById(userId)
        if (!findedUser) return next(createError(404, 'User not exist'))

        const updatedUser = await User.findByIdAndUpdate(userId, { $set: { role } }, { new: true, runValidators: true })
        res.status(200).json({ result: updatedUser, message: 'Role updated successfully', success: true })

    } catch (err) {
        next(createError(500, err.message))
    }
}

export const deleteUser = async (req, res, next) => {
    try {
        const { userId } = req.params
        const findedUser = await User.findById(userId)
        if (!findedUser) return next(createError(400, 'User not exist'))

        const deletedUser = await User.findByIdAndDelete(userId)
        res.status(200).json({ result: deletedUser, message: 'User deleted successfully', success: true })

    } catch (err) {
        next(createError(500, err.message))
    }
}

export const deleteWholeCollection = async (req, res, next) => {
    try {

        const result = await User.deleteMany()
        res.status(200).json({ result, message: 'User collection deleted successfully', success: true })

    } catch (err) {
        next(createError(500, err.message))
    }
}
