import { useEffect, useState } from 'react'
import { Button } from 'react-bootstrap'
import { useDispatch, useSelector } from 'react-redux'
import { useOutletContext } from 'react-router-dom'
import './review.css'
import { setGameInfo } from '../../redux/authSlice'

const ReviewAnswers = () => {
    const { roomInfo, gameInfo } = useSelector((state) => state.auth)
    const [socket] = useOutletContext()
    const [hideReview, setHideReview] = useState(false)
    const dispatch = useDispatch()

    // round answers from server, all room's clients
    const [roundAnswers, setRoundAnswers] = useState([])
    useEffect(() => {
        const handleRoundAnswersServer = (data) => {
            setHideReview(false)
            setRoundAnswers((state) => [...state, data])

            const clone = structuredClone(gameInfo)

            clone.reviews = [...gameInfo.reviews, data]
            dispatch(setGameInfo(clone))
        }

        socket.on('roundAnswersServer', (data) => {
            handleRoundAnswersServer(data)
        })
        return () => socket.off('roundAnswersServer')
    }, [socket, setRoundAnswers, dispatch, gameInfo])

    const handleReviewAnswer = (value, index_1, index_2) => {
        const clone = structuredClone(roundAnswers)

        if (!value) clone?.[index_1]?.data?.[index_2].review.push(false)
        if (value) clone?.[index_1]?.data?.[index_2].review.pop()

        setRoundAnswers(clone)
        // dispatch(setGameInfo(clone))
    }

    const handleSaveReview = () => {
        const clone = structuredClone(roundAnswers)

        clone.map((roundAnswer) => {
            roundAnswer.data.map((userAnswer) => {
                if (userAnswer.answer === '') {
                    userAnswer.review.push(false)
                }
            })
        })

        const dataObject = {
            roomId: roomInfo?.roomId,
            roundResults: clone,
        }

        // send to the server saved review
        socket.emit('roundResults', dataObject)

        // hide review page
        setHideReview(true)

        // set reviewSent to true
        const updateGameInfoObject = {
            reviewSent: true,
        }
        dispatch(setGameInfo(updateGameInfoObject))
    }

    return (
        <>
            {!hideReview && !gameInfo?.reviewSent && (
                <div className="review-box">
                    <br />

                    <h2>Review answers - round {roomInfo?.roundNumber}</h2>

                    <hr />

                    {gameInfo?.reviews?.map((userObject, index_1) => (
                        <div key={index_1}>
                            <h1>{userObject?.nickname}</h1>

                            {userObject?.data?.map((item, index_2) => (
                                <div
                                    key={index_2}
                                    style={{
                                        display: 'flex',
                                        justifyContent: 'space-between',
                                    }}
                                >
                                    <h4>
                                        {item?.category}: {item?.answer}
                                    </h4>

                                    <input
                                        type="checkbox"
                                        defaultChecked={
                                            item?.answer === '' ? false : true
                                        }
                                        onChange={(e) => {
                                            handleReviewAnswer(
                                                e.target.checked,
                                                index_1,
                                                index_2
                                            )
                                        }}
                                    />
                                </div>
                            ))}

                            <br />
                        </div>
                    ))}
                    <hr style={{ marginTop: '0px' }} />
                    <Button
                        variant="dark"
                        onClick={handleSaveReview}
                        style={{ margin: 'auto', marginTop: '12px' }}
                    >
                        Send review
                    </Button>
                </div>
            )}

            {gameInfo?.reviewSent && (
                <h4 style={{ marginTop: '12px' }}>Wait for all players...</h4>
            )}
        </>
    )
}

export default ReviewAnswers
