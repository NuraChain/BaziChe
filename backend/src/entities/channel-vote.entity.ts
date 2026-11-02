import { Check, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';

import { POLL_ANSWERS_MOST } from '../domains/channel/rules.ts';
import { ChannelPost } from './channel-post.entity.ts';
import { User } from './user.entity.ts';

/**
 * One answer one person chose in a poll. A poll that takes one answer holds a person to one row; one
 * that takes several, to one row an answer. The server keeps who voted (it has to, to count one vote
 * a person); an anonymous poll never says it to anybody.
 */
@Check('channel_votes_choice_range', `choice between 0 and ${ POLL_ANSWERS_MOST - 1 }`)
@Index('channel_votes_user', ['userId'])
@Entity('channel_votes')
export class ChannelVote
{
    @PrimaryColumn({ name: 'post_id', type: 'uuid' })
    postId!: string;

    @PrimaryColumn({ name: 'user_id', type: 'uuid' })
    userId!: string;

    @PrimaryColumn({ type: 'smallint' })
    choice!: number;

    @CreateDateColumn({ name: 'voted_at', type: 'timestamptz' })
    votedAt!: Date;

    @ManyToOne(() => ChannelPost, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'post_id', referencedColumnName: 'id' })
    post!: ChannelPost;

    @ManyToOne(() => User, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'user_id', referencedColumnName: 'id' })
    user!: User;
}
