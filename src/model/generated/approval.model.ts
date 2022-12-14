import {Entity as Entity_, Column as Column_, PrimaryColumn as PrimaryColumn_, ManyToOne as ManyToOne_, Index as Index_} from "typeorm"
import * as marshal from "./marshal"
import {Token} from "./token.model"
import {Owner} from "./owner.model"

@Entity_()
export class Approval {
  constructor(props?: Partial<Approval>) {
    Object.assign(this, props)
  }

  @PrimaryColumn_()
  id!: string

  @Index_()
  @ManyToOne_(() => Token, {nullable: false})
  token!: Token

  @Index_()
  @ManyToOne_(() => Owner, {nullable: true})
  owner!: Owner | undefined | null

  @Index_()
  @ManyToOne_(() => Owner, {nullable: true})
  approved!: Owner | undefined | null

  @Column_("numeric", {transformer: marshal.bigintTransformer, nullable: false})
  timestamp!: bigint

  @Column_("int4", {nullable: false})
  block!: number

  @Column_("text", {nullable: false})
  transactionHash!: string
}
