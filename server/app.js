const express = require('express')
const app = express()
const bodyParser = require('body-parser')
const cors = require('cors')
const dotenv = require('dotenv')
const authRoutes = require('./routes/authRoutes')
const roomRoutes = require('./routes/roomRoutes')
const http = require('http')
const dbConnect = require('./config/DatabaseConfig')
const Room = require('./models/Room')
const {
    saveRoundResults,
    calculateGamePoints,
    saveClientRoundReview,
    startGameConfig,
} = require('./config/GameConfig')

dotenv.config()
app.use(cors())
app.use(express.json())
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }))

const server = http.createServer(app)

const io = require('socket.io')(server, {
    allowEIO3: true,
    cors: {
        // origin: 'https://socialcloudclient.onrender.com',
        origin: [
            'http://localhost:5173',
            'https://panstwamiastaclient.onrender.com',
        ],
        methods: ['GET', 'POST'],
    },
})
io.use((socket, next) => {
    const userId = socket.handshake.auth.userId
    if (!userId) {
        return next(new Error('invalid userId'))
    }
    socket.userId = userId
    next()
})
io.on('connection', async (socket) => {
    try {
        // connection event
        console.log('user connected: ', socket.userId, socket.id)

        // on room join
        socket.on('roomJoin', async ({ roomId }) => {
            const room = await Room.findOne({ roomId })
            if (!room)
                return (
                    console.log('no room found'),
                    socket.emit('roomJoinData', {
                        error: 'no room found',
                    })
                )

            if (room?.roomJoinable) {
                // join socket client to the room
                socket.join(roomId)

                // check if user nickname is already in tha clients array
                let isClient = false
                room?.clients?.forEach((client) => {
                    if (client === socket.userId) return (isClient = true)
                })

                // add user nickname to the database clients array
                if (!isClient) {
                    room.clients.push(socket.userId)
                    await Room.findByIdAndUpdate(
                        { _id: room._id },
                        { clients: room.clients }
                    )

                    socket.emit('roomJoinData', {
                        room,
                        message: `${socket.userId} joined the room`,
                    })
                    socket.nsp.to(roomId).emit('roomJoinMsg', {
                        message: `${socket.userId}'s joined the room`,
                    })

                    console.log(
                        `${socket.userId} ${socket.id}'s joined Room ${roomId}`
                    )
                }

                if (isClient) {
                    socket.emit('roomJoinData', {
                        room,
                        message: `${socket.userId}'s rejoined the room`,
                    })
                    socket.nsp.to(roomId).emit('roomJoinMsg', {
                        message: `${socket.userId}'s rejoined the room`,
                    })

                    console.log(
                        `${socket.userId} ${socket.id}'s rejoined Room ${roomId}`
                    )
                }
            }

            if (!room?.roomJoinable) {
                // check if user client was in the game
                let isClient = false
                room.clients.forEach((client) => {
                    if (client === socket.userId) {
                        socket.join(roomId)
                        isClient = true

                        socket.emit('roomJoinData', {
                            room,
                            message: `${socket.userId}'s rejoined the room`,
                        })
                        socket.nsp.to(roomId).emit('roomJoinMsg', {
                            message: `${socket.userId}'s rejoined the room`,
                        })

                        console.log(
                            `${socket.userId} ${socket.id}'s rejoined Room ${roomId}`
                        )
                    }
                })

                if (!isClient) {
                    socket.emit('roomJoinData', {
                        error: 'cannot join the room, game has already started',
                    })
                    console.log('cannot join the room, game has aleady started')
                }
            }
        })

        // on room message
        socket.on('sendRoomMessage', ({ user, roomId, message }) => {
            socket.to(roomId).emit('receiveRoomMessage', {
                message,
                sender: user,
            })
        })

        // on start the game / on next round start
        socket.on('startGame', async ({ roomId }) => {
            // // set roomJoinable status to false and increase round number value by 1
            // const room = await Room.findOne({ roomId })
            // if (!room) return console.log('no room found')
            // if (room.roundNumber >= room?.roundQuantity)
            //     return console.log('max round reched')

            // const roomUpdate = await Room.findByIdAndUpdate(
            //     { _id: room._id },
            //     { roomJoinable: false, roundNumber: room.roundNumber + 1 },
            //     { new: true }
            // )

            // start round and send updated room data to all room's clients
            // const character = randomCharacter()

            const startGameObject = await startGameConfig(roomId)
            socket.nsp.to(roomId).emit('startGameRoom', startGameObject)
        })

        // on end game
        socket.on('endGame', async ({ roomId }) => {
            const res = await Room.findOne({ roomId })
            socket.nsp.to(roomId).emit('endGameRoom', res)
        })

        // on round answers
        socket.on('roundAnswers', (dataObject) => {
            console.log('round answers: ', dataObject)

            socket.nsp
                .to(dataObject?.roomId)
                .emit('roundAnswersServer', dataObject)
        })

        // on round results (reviewed answers)
        socket.on('roundResults', async (dataObject) => {
            // save round data to da database
            saveRoundResults(dataObject?.roomId, dataObject?.roundResults)

            // add to the database information about client who saved review answers
            // only if all active room's clients have sent their reviewed answers, next round runs
            const canStartNextRound = await saveClientRoundReview(
                dataObject?.roomId,
                socket?.userId
            )

            console.log('can server start next round? ', canStartNextRound)

            if (canStartNextRound) {
                // start round and send updated room data to all room's clients
                const startGameObject = await startGameConfig(
                    dataObject?.roomId
                )

                // if startGameObject exists start next round
                if (startGameObject) {
                    socket.nsp
                        .to(dataObject?.roomId)
                        .emit('startGameRoom', startGameObject)
                }

                // if startGameObject does not exists means that all rounds've been played, fetch game point result
                if (!startGameObject) {
                    const gamePoints = await calculateGamePoints(
                        dataObject?.roomId
                    )
                    socket.nsp
                        .to(dataObject?.roomId)
                        .emit('gamePointsServer', gamePoints)
                }
            }
        })

        socket.on('gamePoints', async (roomId) => {
            const gamePoints = await calculateGamePoints(roomId.roomId)
            socket.nsp.to(roomId?.roomId).emit('gamePointsServer', gamePoints)
        })

        // on game restart
        socket.on('restartGame', async ({ roomId }) => {
            const room = await Room.findOne({ roomId })
            if (!room) return console.log('no room found')

            const roomRestart = await Room.findByIdAndUpdate(
                { _id: room._id },
                {
                    roomJoinable: true,
                    roundNumber: 0,
                    roundReviews: [],
                    gameData: [],
                },
                { new: true }
            )

            socket.nsp.to(roomId).emit('restartGameRoom', roomRestart)
        })

        // disconnection event
        socket.on('disconnect', () => {
            // clientDisconnect(socket.userId)
            console.log('user disconnected: ', socket.userId)
            socket.to(socket.id).emit('onDisconnect')
        })
    } catch (err) {
        console.log(err)
    }
})

server.listen(3000, () => {
    console.log('server works')
})
dbConnect()

//routes
app.use(authRoutes)
app.use(roomRoutes)
