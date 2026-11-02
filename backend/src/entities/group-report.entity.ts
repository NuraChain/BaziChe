import { Check, Column, CreateDateColumn, Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { GROUP_REPORT_STATES, type GroupReportState } from '../domains/group/roles.ts';
import { Group } from './group.entity.ts';
import { Report } from './report.entity.ts';
import { User } from './user.entity.ts';

const listed = (values: readonly string[]) => values.map((value) => `'${ value }'`).join(', ');

/**
 * A report about a line in a group's room, as the group's own staff work it (MS-D40 to MS-D45).
 *
 * The words are the report's own disclosure, which franking verified when it was filed, and who it is
 * about is the report's too: this row keeps only where the group's staff have got to with it. It never
 * names who filed it, which the report does for Nura's team alone.
 */
@Check('group_reports_state_known', `state in (${ listed(GROUP_REPORT_STATES) })`)
@Check('group_reports_closed_when', `(state = 'open') = (closed_at is null)`)
@Index('group_reports_queue', ['groupId', 'createdAt'])
@Entity('group_reports')
export class GroupReport
{
    @PrimaryGeneratedColumn('uuid')
    id!: string;

    @Column({ name: 'group_id', type: 'uuid' })
    groupId!: string;

    @Column({ name: 'report_id', type: 'uuid', unique: true })
    reportId!: string;

    @Column({ type: 'varchar', length: 16 })
    state!: GroupReportState;

    @Column({ name: 'closed_by', type: 'uuid', nullable: true })
    closedBy!: string | null;

    @Column({ name: 'closed_at', type: 'timestamptz', nullable: true })
    closedAt!: Date | null;

    @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
    createdAt!: Date;

    @ManyToOne(() => Group, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'group_id', referencedColumnName: 'id' })
    group!: Group;

    @ManyToOne(() => Report, { onDelete: 'CASCADE' })
    @JoinColumn({ name: 'report_id', referencedColumnName: 'id' })
    report!: Report;

    @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
    @JoinColumn({ name: 'closed_by', referencedColumnName: 'id' })
    closer!: User | null;
}
