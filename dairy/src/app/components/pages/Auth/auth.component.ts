import { CommonModule } from "@angular/common";
import { Component, OnDestroy, OnInit } from "@angular/core";
import { ReactiveFormsModule } from "@angular/forms";

@Component({
  selector: 'app-auth',
  templateUrl: './auth.component.html',
  styleUrls: ['./auth.component.scss'],
  standalone: true,
  imports: [
    CommonModule,
    ReactiveFormsModule,
    
  ]
})
export class AuthComponent implements OnInit, OnDestroy {
  constructor() {};

  ngOnInit(): void {
    
  }

  ngOnDestroy(): void {
    
  }
}